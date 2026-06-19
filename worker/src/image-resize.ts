// TODO: Image resizing not yet implemented in Workers environment.
// Images are stored at original size. Track in GitHub Issue #28.
// See: https://github.com/amoscao/lunchbench/issues/28

const MAX_DIMENSION = 1200

export async function resizeImage(
  buf: ArrayBuffer,
  _contentType: string
): Promise<ArrayBuffer> {
  void MAX_DIMENSION
  return buf
}
