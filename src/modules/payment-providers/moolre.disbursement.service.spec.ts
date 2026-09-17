import { BadRequestException } from '@nestjs/common';
import { MoolreDisbursementService } from './moolre.disbursement.service';

function makeService(overrides: Record<string, unknown> = {}, httpPost?: any) {
  return new MoolreDisbursementService({ config: overrides, httpPost });
}

describe('MoolreDisbursementService.initiateTransfer', () => {
  it('returns a PENDING mock reference in MOCK mode without network I/O', async () => {
    const httpPost = jest.fn();
    const service = makeService({}, httpPost);
    const result = await service.initiateTransfer({
      referenceId: 'payroll-run-1-staff-1',
      amountGhs: 1200,
      recipientPhone: '0244000000',
    });
    expect(result).toEqual({ providerReference: expect.stringMatching(/^mock-moolre-tx-/), status: 'PENDING', mock: true });
    expect(httpPost).not.toHaveBeenCalled();
  });

  it('returns the same mock transfer for a repeated reference id', async () => {
    const service = makeService();
    const first = await service.initiateTransfer({
      referenceId: 'payroll-run-1-staff-1',
      amountGhs: 1200,
      recipientPhone: '0244000000',
    });
    const second = await service.initiateTransfer({
      referenceId: 'payroll-run-1-staff-1',
      amountGhs: 9999,
      recipientPhone: '0555000000',
    });

    expect(second).toEqual(first);
  });

  it('requires a reference id for idempotency', async () => {
    const service = makeService();
    await expect(service.initiateTransfer({ referenceId: '', amountGhs: 10, recipientPhone: '0244000000' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-positive amounts', async () => {
    const service = makeService();
    await expect(service.initiateTransfer({ referenceId: 'r1', amountGhs: 0, recipientPhone: '0244000000' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('posts to the transfer endpoint with the transfer channel map in LIVE mode', async () => {
    const httpPost = jest.fn(async () => ({ status: 200, body: { status: 1, code: 'TR099', data: 'moolre-tx-1' } }));
    const service = makeService({ providerMode: 'LIVE', apiUser: 'u', apiKey: 'k', accountNumber: 'ACC-1' }, httpPost);

    const result = await service.initiateTransfer({
      referenceId: 'payroll-run-1-staff-2',
      amountGhs: 800,
      recipientPhone: '0244000000',
      network: 'MTN',
      narration: 'September salary',
    });

    expect(httpPost).toHaveBeenCalledWith(
      expect.stringContaining('/open/transact/transfer'),
      expect.objectContaining({
        type: 1,
        channel: 1, // transfer channel map: MTN=1 (NOT the initiation map's 13)
        receiver: '233244000000',
        externalref: 'payroll-run-1-staff-2',
        reference: 'September salary',
      }),
      expect.objectContaining({ 'X-API-KEY': 'k' }),
    );
    expect(result.providerReference).toBe('moolre-tx-1');
  });
});

describe('MoolreDisbursementService.getTransferStatus', () => {
  it('resolves the numeric txstatus enum (0/1/2) in LIVE mode', async () => {
    for (const [txstatus, expected] of [[0, 'PENDING'], [1, 'SUCCESSFUL'], [2, 'FAILED']] as const) {
      const httpPost = jest.fn(async () => ({ status: 200, body: { status: 1, code: 'TR099', data: { txstatus } } }));
      const service = makeService({ providerMode: 'LIVE' }, httpPost);
      const result = await service.getTransferStatus('ref-1');
      expect(result.status).toBe(expected);
    }
  });

  it('reads the mock ledger in MOCK mode', async () => {
    const service = makeService();
    await service.initiateTransfer({ referenceId: 'ref-2', amountGhs: 5, recipientPhone: '0244000000' });
    const result = await service.getTransferStatus('ref-2');
    expect(result.status).toBe('PENDING');
    expect(result.mock).toBe(true);
  });

  it('rejects unknown references in the mock ledger', async () => {
    const service = makeService();
    await expect(service.getTransferStatus('missing')).rejects.toBeInstanceOf(BadRequestException);
  });
});
