export const action = jest.fn((name?: string) => {
  const handler = jest.fn();
  handler._actionName = name;
  return handler;
});

export const actions = jest.fn((...names: string[]) => {
  return names.reduce(
    (acc, name) => {
      acc[name] = jest.fn();
      return acc;
    },
    {} as Record<string, jest.Mock>,
  );
});

export default { action, actions };
