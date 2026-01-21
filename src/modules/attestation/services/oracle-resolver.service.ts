// src/modules/attestation/services/oracle-resolver.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, arbitrumSepolia, base, baseSepolia } from 'viem/chains';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { toSimpleSmartAccount } from 'permissionless/accounts';
import { createSmartAccountClient } from 'permissionless';
import { entryPoint07Address } from 'viem/account-abstraction';
import oracleAbi from '../abi/AttestationOracle.json';

@Injectable()
export class OracleResolverService {
  private readonly logger = new Logger(OracleResolverService.name);

  private publicClient: any;
  private sender: any; // AA: smartAccountClient | EOA: walletClient
  private isAA = false; // Modo actual
  private initialized = false;

  private oracleAddress!: `0x${string}`;
  private chain: any;

  constructor(private config: ConfigService) {}

  async initialize() {
    if (this.initialized) return;

    const resolverPk = this.config.get<string>('RESOLVER_KEY');
    const rpcUrl = this.config.get<string>('RPC_URL');
    const chainName = this.config.get<string>('CHAIN');
    const bundlerUrl = this.config.get<string>('PIMLICO_BUNDLER_URL'); // opcional
    const sponsorshipId = this.config.get<string>('PIMLICO_SPONSORSHIP_ID'); // opcional
    this.oracleAddress = this.config.get<string>(
      'ORACLE_ADDRESS',
    ) as `0x${string}`;

    if (!resolverPk || !rpcUrl || !chainName || !this.oracleAddress) {
      this.logger.error('Faltan RESOLVER_KEY, RPC_URL, CHAIN u ORACLE_ADDRESS');
      throw new Error('Configuración blockchain incompleta');
    }

    // Selección de red
    const chains: Record<string, any> = {
      base: base,
      'base-sepolia': baseSepolia,
      arbitrum: arbitrum,
      'arbitrum-sepolia': arbitrumSepolia,
    };
    this.chain = chains[chainName];
    if (!this.chain) throw new Error(`Cadena no soportada: ${chainName}`);
    this.logger.log(`Usando cadena: ${this.chain.name}`);

    // Cliente público (lecturas / receipts)
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(rpcUrl),
    });

    // Cuenta del resolvedor
    const resolver = privateKeyToAccount(resolverPk as `0x${string}`);
    this.logger.log(`EOA address: ${resolver.address}`);

    // ¿Tenemos bundler? -> AA; si no, EOA
    this.isAA = !!bundlerUrl;

    if (this.isAA) {
      // --------- MODO AA (requiere bundler 4337) ---------
      const pimlicoClient = createPimlicoClient({
        chain: this.chain,
        transport: http(bundlerUrl!), // bundler, NO RPC
        entryPoint: { address: entryPoint07Address, version: '0.7' },
      });

      const simpleSmartAccount = await toSimpleSmartAccount({
        client: this.publicClient,
        owner: resolver,
        entryPoint: { address: entryPoint07Address, version: '0.7' },
      });
      this.logger.log(
        `Resolver (Smart Account): ${simpleSmartAccount.address}`,
      );

      const arbitrumParams = chainName.startsWith('arbitrum')
        ? {
            paymasterContext: { sponsorshipPolicyId: sponsorshipId || '' },
            userOperation: {
              estimateFeesPerGas: async () =>
                (await pimlicoClient.getUserOperationGasPrice()).standard,
            },
          }
        : {};

      this.sender = createSmartAccountClient({
        account: simpleSmartAccount,
        chain: this.chain,
        bundlerTransport: http(bundlerUrl!), // bundler aquí
        paymaster: pimlicoClient,
        ...arbitrumParams,
      });

      this.logger.log('✅ Inicializado en modo AA (bundler activo)');
    } else {
      // --------- MODO EOA (tu caso actual, sin bundler) ---------
      this.sender = createWalletClient({
        account: resolver,
        chain: this.chain,
        transport: http(rpcUrl), // RPC normal
      });

      this.logger.log('✅ Inicializado en modo EOA (sin bundler)');
    }

    this.initialized = true;
  }

  /** Lee ventana activa (segundos epoch) */
  async getAttestTimes(): Promise<{ start: number; end: number }> {
    await this.initialize();
    const [start, end] = await Promise.all([
      this.publicClient.readContract({
        address: this.oracleAddress,
        abi: oracleAbi,
        functionName: 'attestStart',
        args: [],
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.oracleAddress,
        abi: oracleAbi,
        functionName: 'attestEnd',
        args: [],
      }) as Promise<bigint>,
    ]);
    return { start: Number(start), end: Number(end) };
  }

  /** Solo el end, por conveniencia */
  async getAttestEnd(): Promise<number> {
    await this.initialize();
    const end = (await this.publicClient.readContract({
      address: this.oracleAddress,
      abi: oracleAbi,
      functionName: 'attestEnd',
      args: [],
    })) as bigint;
    return Number(end);
  }

  /** Utilidad para setActiveTime(start,end) */
  private async setActiveTimeRange(
    startSec: number,
    endSec: number,
  ): Promise<void> {
    await this.initialize();
    const data = encodeFunctionData({
      abi: oracleAbi,
      functionName: 'setActiveTime',
      args: [BigInt(startSec), BigInt(endSec)],
    });
    const hash = await this.sender.sendTransaction({
      to: this.oracleAddress,
      value: 0n,
      data,
    });
    this.logger.log(`setActiveTime(${startSec}, ${endSec}) tx=${hash}`);
    await this.publicClient.waitForTransactionReceipt({ hash });
  }

  /** “Abrir” ventana ahora por un tiempo configurable (global al contrato) */
  async setActiveTimeOpen(_electionId: string): Promise<void> {
    const windowSecs = Number(this.config.get('ATTEST_WINDOW_SECS') ?? 600); // 10 min por defecto
    const now = Math.floor(Date.now() / 1000);
    await this.setActiveTimeRange(now - 1, now + windowSecs);
  }

  /** “Cerrar” ventana ahora (global al contrato) */
  async setActiveTimeClose(_electionId: string): Promise<void> {
    const { start } = await this.getAttestTimes();
    const now = Math.floor(Date.now() / 1000);
    await this.setActiveTimeRange(start || now - 1, now);
  }

  /** ID compuesto que espera tu contrato (ajústalo si tu ABI usa solo tableCode) */
  private createContractId(tableCode: string, electionId: string): string {
     this.logger.log(`${tableCode}-${electionId}`);
    return `${tableCode}-${electionId}`;
  }

  /** Batch de resoluciones. En AA manda batch; en EOA envía 1 tx por item. */
  async resolveAttestations(
    items: Array<{ tableCode: string; electionId: string }>,
  ): Promise<{
    success: boolean;
    hash?: string;
    hashes?: string[];
    error?: string;
  }> {
    try {
      await this.initialize();

      if (!items?.length) {
        this.logger.warn('No hay items para resolver');
        return { success: true };
      }

      this.logger.log(
        `🔗 Resolviendo ${items.length} atestiguamientos on-chain...`,
      );

      // Prepara los payloads
      const calls = items.map((it) => ({
        to: this.oracleAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: oracleAbi,
          functionName: 'resolve',
          args: [this.createContractId(it.tableCode, it.electionId)],
        }),
      }));

      if (this.isAA) {
        // ----- AA: batch nativo -----
        const hash = await this.sender.sendTransaction({ calls });
        this.logger.log(`✅ UserOp enviada. Hash: ${hash}`);
        await this.publicClient.waitForTransactionReceipt({ hash });
        this.logger.log(`✅ UserOp confirmada`);
        return { success: true, hash };
      } else {
        // ----- EOA: una tx por call -----
        const hashes: string[] = [];
        for (const c of calls) {
          const txHash = await this.sender.sendTransaction({
            to: c.to,
            data: c.data,
            value: c.value,
          });
          this.logger.log(`↳ tx enviada: ${txHash}`);
          await this.publicClient.waitForTransactionReceipt({ hash: txHash });
          hashes.push(txHash);
        }
        this.logger.log(`✅ ${hashes.length} tx confirmadas (EOA)`);
        return { success: true, hash: hashes[hashes.length - 1], hashes };
      }
    } catch (err: any) {
      this.logger.error('❌ Error al resolver atestiguamientos on-chain:', err);
      return { success: false, error: err?.message ?? String(err) };
    }
  }

  /** Lectura del estado en contrato */
  async getAttestationInfo(
    tableCode: string,
    electionId: string,
  ): Promise<{ status: number; finalResult: bigint } | null> {
    try {
      await this.initialize();
      const contractId = this.createContractId(tableCode, electionId);
      const result = await this.publicClient.readContract({
        address: this.oracleAddress,
        abi: oracleAbi,
        functionName: 'getAttestationInfo',
        args: [contractId],
      });
      const [resolved, finalResult] = result as [number, bigint];
      return { status: resolved, finalResult };
    } catch (err) {
      this.logger.error(`Error leyendo atestiguamiento ${tableCode}:`, err);
      return null;
    }
  }

  /** Mapeo enum -> estado interno */
  mapContractStatusToString(
    status: number,
  ): 'VERIFYING' | 'PENDING' | 'CONSENSUAL' | 'CLOSED' {
    // enum AttestationState { OPEN, CONSENSUAL, VERIFYING, CLOSED, PENDING }
    switch (status) {
      case 0:
        return 'VERIFYING'; // OPEN
      case 1:
        return 'CONSENSUAL';
      case 2:
        return 'VERIFYING';
      case 3:
        return 'CLOSED';
      case 4:
        return 'PENDING';
      default:
        return 'VERIFYING';
    }
  }

  /** Registro on-chain (usa AA si hay bundler; si no, EOA) */
  async registerUser(
    user: string,
    isJury: boolean,
  ): Promise<{ success: boolean; hash?: string }> {
    try {
      await this.initialize();

      const data = encodeFunctionData({
        abi: oracleAbi,
        functionName: 'register',
        args: [user, isJury],
      });

      if (this.isAA) {
        const hash = await this.sender.sendTransaction({
          to: this.oracleAddress,
          value: 0n,
          data,
        });
        this.logger.log(`✅ register (AA): ${hash}`);
        return { success: true, hash };
      } else {
        const hash = await this.sender.sendTransaction({
          to: this.oracleAddress,
          value: 0n,
          data,
        });
        this.logger.log(`✅ register (EOA): ${hash}`);
        return { success: true, hash };
      }
    } catch (err) {
      this.logger.error('❌ Error al registrar usuario on-chain:', err);
      return { success: false };
    }
  }
}
