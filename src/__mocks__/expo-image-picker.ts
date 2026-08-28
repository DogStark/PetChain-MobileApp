export const requestCameraPermissionsAsync = jest.fn().mockResolvedValue({ granted: true });
export const launchCameraAsync = jest.fn().mockResolvedValue({ canceled: true, assets: [] });
export const MediaTypeOptions = { Images: 'Images', Videos: 'Videos', All: 'All' };
