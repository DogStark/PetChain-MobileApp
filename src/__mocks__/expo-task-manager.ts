const TaskManager = {
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
  unregisterAllTasksAsync: jest.fn().mockResolvedValue(undefined),
};

export default TaskManager;
export const { defineTask, isTaskRegisteredAsync, unregisterAllTasksAsync } = TaskManager;
