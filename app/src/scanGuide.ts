// Insets in the visible camera preview, shared by the overlay and frame crop.
export const scanGuide = { xInset: 0.1, yInset: 0.27 };

export function getScanGuideRegion(video: HTMLVideoElement) {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
  // The preview uses a centered object-fit: cover. Convert the visible area
  // back to source pixels before applying the guide's insets.
  const previewScale = clientWidth && clientHeight
    ? Math.max(clientWidth / videoWidth, clientHeight / videoHeight)
    : 0;
  const visibleWidth = previewScale ? clientWidth / previewScale : videoWidth;
  const visibleHeight = previewScale ? clientHeight / previewScale : videoHeight;
  const width = visibleWidth * (1 - 2 * scanGuide.xInset);
  const height = visibleHeight * (1 - 2 * scanGuide.yInset);
  return { x: (videoWidth - width) / 2, y: (videoHeight - height) / 2, width, height };
}
