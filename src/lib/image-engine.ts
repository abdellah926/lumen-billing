export type Scale = 2 | 3 | 4;

export type ImageEngine = {
  name: string;
  maxScale: Scale;
};

export const imageEngine: ImageEngine = {
  name: "Real-ESRGAN",
  maxScale: 4,
};
