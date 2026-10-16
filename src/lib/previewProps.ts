import type { LabelObject } from '@zplab/core/types/Group';

/** A panel previews props of its own object type, so the merged leaf keeps the object's type. */
export function withPreviewProps<T extends LabelObject>(obj: T, preview: Record<string, unknown> | undefined): T {
  if (!preview || !('props' in obj)) return obj;
  return { ...obj, props: { ...obj.props, ...preview } } as T;
}
