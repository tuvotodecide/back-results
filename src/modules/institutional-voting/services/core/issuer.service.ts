import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { VotingEventDocument } from "../../schemas/voting-event.schema";
import { Types } from "mongoose";

export type VCclaimData = {
  id: string;
}

export type DidByDniResponse = {
  ok: boolean;
  records: {
    dni: string;
    did: string;
  }[];
}

@Injectable()
export class IssuerService {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly issuerDid: string;
  private readonly credSchema: string;
  private readonly credType: string;

  private readonly identityBaseUrl: string;
  private readonly identityApiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.baseUrl = this.configService.get<string>('app.issuer.baseUrl')!;
    this.username = this.configService.get<string>('app.issuer.username')!;
    this.password = this.configService.get<string>('app.issuer.password')!;
    this.issuerDid = this.configService.get<string>('app.issuer.did')!;
    this.credSchema = this.configService.get<string>('app.zkAuth.credSchema')!;
    this.credType = this.configService.get<string>('app.zkAuth.credType')!;
    this.identityBaseUrl = this.configService.get<string>('app.identity.baseUrl')!;
    this.identityApiKey = this.configService.get<string>('app.identity.apiKey')!;
  }

  async issueCredential(dnis: string[], eventId: string, nullifiers: string[]) {
    if(dnis.length === 0 || dnis.length !== nullifiers.length) {
      throw new InternalServerErrorException(`DNIs and nullifiers arrays must be of the same non-zero length`);
    }

    const url = `${this.baseUrl}/v2/identities/${this.issuerDid}/credentials`;
    const users = await this.getDidsByDnis(dnis);

    const promises: Promise<void>[] = [];
    const credentialData: Record<string, { credentialData: string }> = {};
    for (const user of users) {
      const body = {
        credentialSchema: this.credSchema,
        type: this.credType,
        credentialSubject: {
          id: user.did,
          eventId: eventId,
          nullifier: nullifiers.shift(),
        },
      }

      promises.push(new Promise(async (resolve, reject) => {
        this.httpService.axiosRef.post<VCclaimData>(url, body, {
          auth: {
            username: this.username,
            password: this.password,
          },
        }).then(response => {
          credentialData[user.dni] = {
            credentialData: response.data.id,
          };
          resolve();
        }).catch(error => reject(error));
      }));
    }

    try {
      await Promise.all(promises);
    } catch (error: any) {
      console.error(`Error issuing credential:`, error.response?.data || error.message);
      throw new InternalServerErrorException(`Error issuing credential for DNI`);
    }

    return credentialData;
  }

  async getDidsByDnis(dnis: string[]) {
    const url = `${this.identityBaseUrl}/registry/get-by-dni`;
    try {
      const response = await this.httpService.axiosRef.get<DidByDniResponse>(url, {
        params: {
          dnis: dnis.join(','),
        },
        headers: {
          'x-api-key': this.identityApiKey,
        }
      });

      if (!response.data.ok) {
        throw new Error(`Identity service responded with ok=false: ${JSON.stringify(response.data)}`);
      }

      return response.data.records;
    } catch (error: any) {
      console.error('Error fetching DIDs for DNIs:', error.response?.data || error.message);
      throw new InternalServerErrorException(`Error fetching DIDs for given DNIs`);
    }
  }
}