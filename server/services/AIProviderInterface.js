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

  analyzeProductImages() {
    throw new Error('analyzeProductImages must be implemented.');
  }
}
