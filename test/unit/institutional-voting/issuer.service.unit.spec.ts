import { InternalServerErrorException } from '@nestjs/common';

import { IssuerService } from '@/modules/institutional-voting/services/core/issuer.service';

describe('IssuerService.getCredentialOffer (unit)', () => {
  const config: Record<string, string> = {
    'app.issuer.baseUrl': 'https://issuer.test',
    'app.issuer.username': 'user',
    'app.issuer.password': 'secret',
    'app.issuer.did': 'did:iden3:issuer',
    'app.zkAuth.credSchema': 'ipfs://schema',
    'app.zkAuth.credType': 'SelectedVoter',
    'app.identity.baseUrl': 'https://identity.test',
    'app.identity.apiKey': 'key',
  };
  let get: jest.Mock;
  let service: IssuerService;

  beforeEach(() => {
    get = jest.fn();
    service = new IssuerService(
      { get: (key: string) => config[key] } as any,
      { axiosRef: { get } } as any,
    );
  });

  it('VOT-VC-OFR-01 pide la oferta deepLink con basic auth y devuelve universalLink', async () => {
    get.mockResolvedValue({ data: { universalLink: 'iden3comm://?request_uri=https%3A%2F%2Fissuer.test%2Fqr' } });

    await expect(service.getCredentialOffer('cred/1')).resolves.toBe(
      'iden3comm://?request_uri=https%3A%2F%2Fissuer.test%2Fqr',
    );
    expect(get).toHaveBeenCalledWith(
      'https://issuer.test/v2/identities/did:iden3:issuer/credentials/cred%2F1/offer',
      {
        params: { type: 'deepLink' },
        auth: { username: 'user', password: 'secret' },
      },
    );
  });

  it('VOT-VC-OFR-02 lanza InternalServerErrorException si el issuer no devuelve el enlace', async () => {
    get.mockResolvedValue({ data: { universalLink: '  ' } });

    await expect(service.getCredentialOffer('cred-1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('VOT-VC-OFR-03 lanza InternalServerErrorException si la petición al issuer falla', async () => {
    get.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 404, data: { message: 'not found' } } }));

    await expect(service.getCredentialOffer('cred-1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
