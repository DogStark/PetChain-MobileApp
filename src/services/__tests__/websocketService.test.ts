import WebsocketService from '../websocketService';

describe('WebsocketService backoff', () => {
  jest.useFakeTimers();

  it('doubles backoff on each reconnect attempt up to max', () => {
    const svc = new WebsocketService('ws://localhost:1234');
    // stub actual connect to avoid creating real WebSocket
    (svc as any)._connect = jest.fn();
    (svc as any).backoffMs = 500;
    (svc as any).maxBackoff = 2000;

    // first schedule
    (svc as any).scheduleReconnect();
    // fast-forward initial delay
    jest.advanceTimersByTime(500);
    expect((svc as any)._connect).toHaveBeenCalledTimes(1);
    expect((svc as any).backoffMs).toBe(1000);

    // second schedule
    (svc as any).scheduleReconnect();
    jest.advanceTimersByTime(1000);
    expect((svc as any)._connect).toHaveBeenCalledTimes(2);
    expect((svc as any).backoffMs).toBe(2000);

    // third schedule should cap at maxBackoff
    (svc as any).scheduleReconnect();
    jest.advanceTimersByTime(2000);
    expect((svc as any)._connect).toHaveBeenCalledTimes(3);
    expect((svc as any).backoffMs).toBe(2000);
  });

  it('starts with the default initial backoff value', () => {
    const svc = new WebsocketService('ws://localhost:1234');
    expect((svc as any).backoffMs).toBe(500);
  });
});
