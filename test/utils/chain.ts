export const chain = <T = any>(val: T) => {
  const q: any = {};
  q.exec     = jest.fn().mockResolvedValue(val);
  q.lean     = jest.fn().mockResolvedValue(val);
  q.sort     = jest.fn().mockReturnThis();
  q.skip     = jest.fn().mockReturnThis();
  q.limit    = jest.fn().mockReturnThis();
  q.select   = jest.fn().mockReturnThis();
  q.populate = jest.fn().mockReturnThis();
  q.orFail   = jest.fn().mockReturnThis();
  q.then = (res: any, rej: any) => Promise.resolve(val).then(res, rej);
  return q;
};

export const rejectChain = (err: any) => {
  const q: any = chain(undefined);
  q.exec = jest.fn().mockRejectedValue(err);
  q.lean = jest.fn().mockRejectedValue(err);
  q.then = (res: any, rej: any) => Promise.reject(err).then(res, rej);
  return q;
};
