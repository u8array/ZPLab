import { getEntry } from './index';
import { GS1_SAMPLE_CONTENT } from '../lib/gs1';

/** The sample a blank field renders on canvas and in the Labelary preview
 *  overlay: the type's placeholderContent, or the GS1 sample once the field
 *  is in GS1 mode (the type sample would not encode there). Never part of
 *  emit, export or print; a blank field's ^FD stays empty there. */
export function placeholderContentFor(type: string, props: object): string | undefined {
  if ((props as { gs1?: boolean }).gs1) return GS1_SAMPLE_CONTENT;
  return getEntry(type)?.placeholderContent;
}

/** Props for sample rendering: the type's sampleProps overrides merged in, so
 *  the sample stays encodable where the object's own props would reject it
 *  (see ObjectTypeCore.sampleProps). */
export function samplePropsFor<P extends object>(type: string, props: P): P {
  const overrides = getEntry(type)?.sampleProps;
  return overrides ? { ...props, ...overrides } : props;
}
