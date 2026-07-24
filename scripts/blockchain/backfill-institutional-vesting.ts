import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const OFFICIAL = {
  chainId: 84532,
  tvdToken: getAddress('0x0156D96BAbC74139a5cdb2cf2C90FDA1F6B53562'),
  institutionalVesting: getAddress('0x334cD0dEA742eb3610F9Da2CA290464D3C4b00d2'),
  electoralCredits: getAddress('0xBB4Ea03105E2D883AB234D95f10dc7CC5000bB40'),
  operator: getAddress('0xA178F11d2029E1A89CF61081A3Ce36fD6b705A58'),
  smartAccount: getAddress('0x270cf6f9377a6d2BBE97A3dC42A1Ce90D46363f8'),
  legacyVesting: getAddress('0x46f0615cc1dBc109c2c49Ca4F1ec9217f828F8E1'),
  targetAssignedBalance: 11_000_000_000_000_000_000n,
} as const;

const assignmentAbi = parseAbi([
  'function token() view returns (address)',
  'function owner() view returns (address)',
  'function operator() view returns (address)',
  'function creditsContract() view returns (address)',
  'function assignedBalance(address) view returns (uint256)',
  'function totalAssigned() view returns (uint256)',
  'function assign(address institution, uint256 amount)',
  'event TokensAssigned(address indexed institution, uint256 amount)',
]);

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
]);

function loadEnv(repoRoot: string): Record<string, string> {
  const envPath = join(repoRoot, '.env');
  if (!existsSync(envPath)) {
    throw new Error(`.env no encontrado en ${repoRoot}`);
  }
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ''),
        ];
      }),
  );
}

function assertAddress(value: string | undefined, label: string): `0x${string}` {
  if (!value || !isAddress(value)) {
    throw new Error(`${label} inválida o ausente`);
  }
  return getAddress(value) as `0x${string}`;
}

function assertEqualAddress(actual: string, expected: string, label: string) {
  if (getAddress(actual) !== getAddress(expected)) {
    throw new Error(`${label} mismatch: ${actual}`);
  }
}

async function main() {
  const repoRoot = process.cwd();
  const env = loadEnv(repoRoot);

  const rpcUrl = env.TVD_RPC_URL;
  if (!rpcUrl) {
    throw new Error('TVD_RPC_URL ausente');
  }

  const configuredChainId = Number(env.TVD_CHAIN_ID);
  if (configuredChainId !== OFFICIAL.chainId) {
    throw new Error(`TVD_CHAIN_ID debe ser ${OFFICIAL.chainId}`);
  }

  assertEqualAddress(assertAddress(env.TVD_TOKEN_ADDRESS, 'TVD_TOKEN_ADDRESS'), OFFICIAL.tvdToken, 'TVD token');
  assertEqualAddress(
    assertAddress(env.TVD_ASSIGNMENT_CONTRACT_ADDRESS, 'TVD_ASSIGNMENT_CONTRACT_ADDRESS'),
    OFFICIAL.institutionalVesting,
    'TVD assignment vesting',
  );
  assertEqualAddress(
    assertAddress(env.INSTITUTIONAL_VESTING_ADDRESS, 'INSTITUTIONAL_VESTING_ADDRESS'),
    OFFICIAL.institutionalVesting,
    'Institutional vesting',
  );
  assertEqualAddress(
    assertAddress(env.TVD_ELECTORAL_CREDITS_ADDRESS, 'TVD_ELECTORAL_CREDITS_ADDRESS'),
    OFFICIAL.electoralCredits,
    'Electoral credits',
  );

  const privateKey = env.TVD_OPERATOR_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('TVD_OPERATOR_PRIVATE_KEY inválida o ausente');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  if (getAddress(account.address) !== OFFICIAL.operator) {
    throw new Error(`Operador derivado no coincide: ${account.address}`);
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const chainId = await publicClient.getChainId();
  if (chainId !== OFFICIAL.chainId) {
    throw new Error(`RPC conectado a chainId ${chainId}`);
  }

  const [token, owner, operator, creditsContract, currentAssignedBalance, legacyAssignedBalance, contractTokenBalance, totalAssigned] =
    await Promise.all([
      publicClient.readContract({
        address: OFFICIAL.institutionalVesting,
        abi: assignmentAbi,
        functionName: 'token',
      }),
      publicClient.readContract({
        address: OFFICIAL.institutionalVesting,
        abi: assignmentAbi,
        functionName: 'owner',
      }),
      publicClient.readContract({
        address: OFFICIAL.institutionalVesting,
        abi: assignmentAbi,
        functionName: 'operator',
      }),
      publicClient.readContract({
        address: OFFICIAL.institutionalVesting,
        abi: assignmentAbi,
        functionName: 'creditsContract',
      }),
      publicClient.readContract({
        address: OFFICIAL.institutionalVesting,
        abi: assignmentAbi,
        functionName: 'assignedBalance',
        args: [OFFICIAL.smartAccount],
      }),
      publicClient.readContract({
        address: OFFICIAL.legacyVesting,
        abi: assignmentAbi,
        functionName: 'assignedBalance',
        args: [OFFICIAL.smartAccount],
      }),
      publicClient.readContract({
        address: OFFICIAL.tvdToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [OFFICIAL.institutionalVesting],
      }),
      publicClient.readContract({
        address: OFFICIAL.institutionalVesting,
        abi: assignmentAbi,
        functionName: 'totalAssigned',
      }),
    ]);

  assertEqualAddress(token, OFFICIAL.tvdToken, 'token()');
  assertEqualAddress(operator, OFFICIAL.operator, 'operator()');
  assertEqualAddress(creditsContract, OFFICIAL.electoralCredits, 'creditsContract()');

  if (currentAssignedBalance > OFFICIAL.targetAssignedBalance) {
    throw new Error(`Saldo oficial mayor al objetivo: ${currentAssignedBalance.toString()}`);
  }

  const delta = OFFICIAL.targetAssignedBalance - currentAssignedBalance;
  const result: Record<string, unknown> = {
    status: delta === 0n ? 'IDEMPOTENT_ALREADY_BACKFILLED' : 'BACKFILL_REQUIRED',
    chainId,
    from: account.address,
    owner,
    operator,
    token,
    creditsContract,
    targetContract: OFFICIAL.institutionalVesting,
    institution: OFFICIAL.smartAccount,
    legacyContract: OFFICIAL.legacyVesting,
    legacyAssignedBalance: legacyAssignedBalance.toString(),
    currentAssignedBalance: currentAssignedBalance.toString(),
    targetAssignedBalance: OFFICIAL.targetAssignedBalance.toString(),
    delta: delta.toString(),
    contractTokenBalance: contractTokenBalance.toString(),
    totalAssignedBefore: totalAssigned.toString(),
  };

  if (delta === 0n) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (contractTokenBalance - totalAssigned < delta) {
    throw new Error('El vesting oficial no tiene respaldo ERC-20 libre suficiente para el delta');
  }

  await publicClient.simulateContract({
    account,
    address: OFFICIAL.institutionalVesting,
    abi: assignmentAbi,
    functionName: 'assign',
    args: [OFFICIAL.smartAccount, delta],
  });
  result.simulation = 'OK';

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const txHash = await walletClient.writeContract({
    address: OFFICIAL.institutionalVesting,
    abi: assignmentAbi,
    functionName: 'assign',
    args: [OFFICIAL.smartAccount, delta],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`Receipt revertido: ${txHash}`);
  }

  const tokensAssigned = receipt.logs.some((log) => {
    try {
      const decoded = decodeEventLog({
        abi: assignmentAbi,
        data: log.data,
        topics: log.topics,
      });
      return (
        log.address.toLowerCase() === OFFICIAL.institutionalVesting.toLowerCase() &&
        decoded.eventName === 'TokensAssigned' &&
        getAddress(decoded.args.institution) === OFFICIAL.smartAccount &&
        decoded.args.amount === delta
      );
    } catch {
      return false;
    }
  });

  if (!tokensAssigned) {
    throw new Error('Receipt sin evento TokensAssigned esperado');
  }

  const finalAssignedBalance = await publicClient.readContract({
    address: OFFICIAL.institutionalVesting,
    abi: assignmentAbi,
    functionName: 'assignedBalance',
    args: [OFFICIAL.smartAccount],
  });

  if (finalAssignedBalance !== OFFICIAL.targetAssignedBalance) {
    throw new Error(`Saldo final inesperado: ${finalAssignedBalance.toString()}`);
  }

  console.log(
    JSON.stringify(
      {
        ...result,
        txHash,
        blockNumber: receipt.blockNumber.toString(),
        receiptStatus: receipt.status,
        eventValidated: 'TokensAssigned',
        finalAssignedBalance: finalAssignedBalance.toString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'BACKFILL_FAILED',
        errorName: error?.name,
        message: error?.shortMessage || error?.message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
