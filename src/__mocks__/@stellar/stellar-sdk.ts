export const Keypair = {
  random: jest.fn(),
  fromSecret: jest.fn(),
};

export const Networks = {
  PUBLIC: 'Public Global Stellar Network ; September 2015',
  TESTNET: 'Test SDF Network ; September 2015',
};

export const Asset = {
  native: jest.fn(),
};

export const Operation = {
  payment: jest.fn(),
  manageData: jest.fn(),
};

export const TransactionBuilder = jest.fn();
export const BASE_FEE = '100';

export const Memo = {
  text: jest.fn(),
};

export const Horizon = {
  Server: jest.fn(),
  HorizonApi: {
    BadRequestError: class BadRequestError extends Error {
      response: any;
      constructor(message: string, response: any) {
        super(message);
        this.response = response;
      }
    },
  },
};
