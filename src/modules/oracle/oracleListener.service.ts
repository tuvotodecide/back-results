import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ethers } from "ethers";
import * as oracleAbi from "./AttestationOracle.json";
import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import { LoggerService } from "@/core/services/logger.service";

@Injectable()
export class OracleListenerService implements OnModuleInit, OnModuleDestroy{
  private oracleContract: ethers.Contract;
  private genAI: GoogleGenAI;

  constructor(
    private logger: LoggerService,
  ) {}

  onModuleInit() {
    const apiKey = process.env.API_KEY;
    if(!apiKey) {
      throw Error('API_KEY not set');
    }
    this.genAI = new GoogleGenAI({apiKey});
    this.listenOracle();
  }

  onModuleDestroy() {
    if(this.oracleContract) {
      this.oracleContract.removeAllListeners();
    }
  }

  listenOracle() {
    const oracleAddress = process.env.ORACLE_ADDRESS;
    const privateKey = process.env.PRIVATE_KEY;
    const rcpUrl = process.env.WSS_URL;
    const apiUrl = process.env.IDENTITY_API;
    const identityJwt = process.env.IDENTITY_JWT;
    if(!oracleAddress || !privateKey || !rcpUrl || !apiUrl || !identityJwt) {
      this.logger.error("IDENTITY_API, IDENTITY_JWT, ORACLE_ADDRESS, PRIVATE_KEY or WSS_URL not defined");
      return;
    }

    const provider = new ethers.WebSocketProvider(rcpUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    this.oracleContract = new ethers.Contract(oracleAddress, oracleAbi, wallet);
    this.oracleContract.on('RegisterRequested', (user: string, uri: string) => {
      this.checkRequest(user, uri, apiUrl, identityJwt);
    });
    this.logger.log("Listening to oracle: " + oracleAddress);
  }

  async checkRequest(user: string, uri: string, api: string, jwt: string) {
    const person = await fetch(
      api + '/kyc/find-by-accountAddress',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + jwt,
        },
        body: JSON.stringify({accountAddress: user})
      }
    );
    const jsonPerson = await person.json();

    if(!person.ok) {
      this.logger.log("Failed to fetch users");
      console.log(jsonPerson);
      return;
    }

    if(!jsonPerson.ok) {
      this.logger.log("User not found");
      console.log(jsonPerson);
      return;
    }

    this.logger.log("registering user");
    try {
      let isJury = false;
      if(uri !== "") {
        const juries = await this.getJuriesFromPhoto(uri);
        if(!juries) {
          throw Error("juries not found");
        };

        const isJuryResponse = await fetch(
          api + '/kyc/account-has-dni',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + jwt,
            },
            body: JSON.stringify({accountAddress: user, dnis: juries})
          }
        );

        const jsonResponse = await isJuryResponse.json();
        if(!isJuryResponse.ok) {
          throw Error("Response error: " + jsonResponse);
        }else{
          isJury = jsonResponse.ok;
        }
      }

      this.oracleContract.register(user, isJury);
    } catch (error) {
      this.logger.error("Error registering on oracle: ");
      console.log(error);
    }
  }

  async getJuriesFromPhoto(uri: string) {
    try {
      const response = await axios.get(uri, {
        responseType: 'arraybuffer',
      });

      const aiResp = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: Buffer.from(response.data).toString('base64'),
            },
          },
          { text: this.getAnalysisPrompt() },
        ],
      });

      if(!aiResp.text) {
        throw Error('Failed to get ai text');
      }

      const juries = JSON.parse(aiResp.text);
      if(juries.imageNotClear) {
        throw Error('Image send not clear');
      }

      return juries.data as string[];
    } catch (error) {
      console.error('Failed to get juries: ' + error);
    }
  }

  getAnalysisPrompt() {
    return `Analiza la imagen proporcionada.
PRIMERO, comprueba que exista la sección JURADAS / JURADOS ELECTORALES, y que dentro de esa tabla,
los valores de los campos NUM DOCUMENTO sean legibles.

Si falta la tabla o los valores son ilegibles, responde EXCLUSIVAMENTE:
  {"imageNotClear": true}

SOLO si la imagen cumple con el criterios y se lee claramente, , responde con un ÚNICO JSON siguiendo EXACTAMENTE esta estructura.

{
  "imageNotClear": false,
  "data": [
    <Valor de NUM DOCUMENTO en string>,
    <Valor de NUM DOCUMENTO en string>,
    ...lista todos los valores dentro la tabla JURADAS / JURADOS ELECTORALES
  ]
}

⚠️ Devuelve SOLO el JSON solicitado, sin texto adicional, sin Markdown, sin comillas invertidas.
`;
  }
}