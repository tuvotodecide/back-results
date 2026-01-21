import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import path from 'path';
import ejs from 'ejs';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly sesClient: SESClient;

  constructor(
    private config: ConfigService,
  ) {
    this.sesClient = new SESClient({
      region: this.config.get<string>('app.mail.smtp.region') ?? '',
      credentials: {
        accessKeyId: this.config.get<string>('app.mail.smtp.accessKeyId') ?? '',
        secretAccessKey: this.config.get<string>('app.mail.smtp.secretAccessKey') ?? '',
      }
    })
  }

  createEmail(toAddress: string, subject: string, template: string, templateData: ejs.Data): SendEmailCommand {
    const templateString = this.getTemplate(template);
    const emailBody = ejs.render(templateString, {
      ...templateData,
      logoUrl: this.config.get<string>('app.mail.logoUrl'),
    })

    return new SendEmailCommand({
      Destination: {
        ToAddresses: [toAddress],
      },
      Source: this.config.get('app.mail.smtp.from') ?? '',
      Message: {
        Subject: {
          Charset: 'UTF-8',
          Data: subject,
        },
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: emailBody,
          }
        }
      }
    })
  }

  async sendEmail(
    to: string,
    subject: string,
    template: string,
    data: any,
  ) {
    try {
      const emailsList: string[] = [to];

      if (!emailsList) {
        throw new Error(
          `No recipients found for sending email`,
        );
      }

      const email = this.createEmail(to, subject, template, data);

      await this.sesClient.send(email);
      this.logger.log(
        `Email sent successfully to recipients with the following parameters : ${JSON.stringify({
          to, template, data
        })}`,
      );
    } catch (error) {
      throw new Error(
        `Error while sending mail: ` + error.message,
      );
    }
  }

  getTemplate(templateName: string) {
    const file = path.resolve(path.join(__dirname, '../../../templates'), templateName + '.html');
    return readFileSync(file, 'utf8');
  }
}