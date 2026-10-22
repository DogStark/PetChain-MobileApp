export const Camera = {
  requestCameraPermissionsAsync: jest.fn(),
  Constants: {
    Type: {
      back: 'back',
      front: 'front',
    },
    FlashMode: {
      on: 'on',
      off: 'off',
      auto: 'auto',
      torch: 'torch',
    },
  },
};

export const CameraType = {
  back: 'back',
  front: 'front',
};

export default Camera;
