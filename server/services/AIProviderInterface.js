export class AIProviderInterface {
  generateBanner() {
    throw new Error('generateBanner must be implemented.');
  }

  translateImage() {
    throw new Error('translateImage must be implemented.');
  }

  cutoutImage() {
    throw new Error('cutoutImage must be implemented.');
  }

  removeText() {
    throw new Error('removeText must be implemented.');
  }

  generatePost() {
    throw new Error('generatePost must be implemented.');
  }

  mixImages() {
    throw new Error('mixImages must be implemented.');
  }

  imageToVideo() {
    throw new Error('imageToVideo must be implemented.');
  }

  transformSensitiveMedia() {
    throw new Error('transformSensitiveMedia must be implemented.');
  }

  analyzeProductImages() {
    throw new Error('analyzeProductImages must be implemented.');
  }
}
