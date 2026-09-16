/** A decode that neither loads nor errors would park its caller forever; the
 *  agent-supplied graphics reaching this are answered on a timeout upstream. */
export const DECODE_TIMEOUT_MS = 15_000;

/** Load an image from a URL or data-URL. Rejects with `message` on failure.
 *  Centralises the new Image() + onload/onerror decode boilerplate. */
export function loadImage(src: string, message = 'Failed to load image'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error(message)), DECODE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(message));
    };
    img.src = src;
  });
}

/** A File as data URL plus its decoded image. Rejects a non-image MIME before the read. */
export function decodeImageFile(file: File): Promise<{ dataUrl: string; img: HTMLImageElement }> {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error(`Not an image: ${file.name}`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      loadImage(dataUrl, `Failed to decode image: ${file.name}`)
        .then((img) => resolve({ dataUrl, img }))
        .catch(reject);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
