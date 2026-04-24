const ImageResizer = {
  createResizedImage: jest.fn().mockResolvedValue({
    uri: 'file://resized.jpg',
    size: 512,
    width: 800,
    height: 600,
  }),
};

export default ImageResizer;
