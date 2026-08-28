export const manipulateAsync = jest.fn().mockResolvedValue({
  uri: '/mock/thumbnail.jpg',
  width: 200,
  height: 200,
  base64: 'bW9ja3RodW1ibmFpbA==',
});

export const SaveFormat = {
  JPEG: 'jpeg',
  PNG: 'png',
  WEBP: 'webp',
};
