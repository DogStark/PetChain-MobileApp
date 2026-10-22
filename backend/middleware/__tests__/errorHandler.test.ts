import { errorHandler } from '../errorHandler';

describe('errorHandler middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('should handle generic errors', () => {
    const error = new Error('Test error');

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalled();
  });

  it('should handle validation errors', () => {
    const error = new Error('Validation failed');
    (error as any).statusCode = 400;

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('should handle authentication errors', () => {
    const error = new Error('Unauthorized');
    (error as any).statusCode = 401;

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should handle authorization errors', () => {
    const error = new Error('Forbidden');
    (error as any).statusCode = 403;

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  it('should handle not found errors', () => {
    const error = new Error('Not found');
    (error as any).statusCode = 404;

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(404);
  });

  it('should not expose sensitive error details in production', () => {
    process.env.NODE_ENV = 'production';
    const error = new Error('Database connection failed');

    errorHandler(error, mockReq, mockRes, mockNext);

    const response = mockRes.json.mock.calls[0][0];
    expect(response.message).not.toContain('Database');
  });

  it('should include error details in development', () => {
    process.env.NODE_ENV = 'development';
    const error = new Error('Test error');

    errorHandler(error, mockReq, mockRes, mockNext);

    const response = mockRes.json.mock.calls[0][0];
    expect(response).toHaveProperty('error');
  });

  it('should default to 500 status code', () => {
    const error = new Error('Unknown error');

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
  });

  it('should include error code in response', () => {
    const error = new Error('Test error');
    (error as any).code = 'TEST_ERROR';

    errorHandler(error, mockReq, mockRes, mockNext);

    const response = mockRes.json.mock.calls[0][0];
    expect(response).toHaveProperty('code');
  });
});
