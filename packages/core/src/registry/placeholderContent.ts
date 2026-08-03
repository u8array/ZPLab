import { getEntry, isGs1Active } from './index';
import { GS1_SAMPLE_CONTENT } from '../lib/gs1';

/** The sample a blank field renders on canvas and in the Labelary preview
 *  overlay, never part of emit or print: the type's placeholderContent, or
 *  the GS1 sample in GS1 mode (the type sample would not encode there). */
export function placeholderContentFor(type: string, props: object): string | undefined {
  const entry = getEntry(type);
  if (isGs1Active(entry, props)) return GS1_SAMPLE_CONTENT;
  return entry?.placeholderContent;
}

/** Props for sample rendering: the type's sampleProps overrides merged in, so
 *  the sample stays encodable where the object's own props would reject it
 *  (see ObjectTypeCore.sampleProps). */
export function samplePropsFor<P extends object>(type: string, props: P): P {
  const overrides = getEntry(type)?.sampleProps;
  return overrides ? { ...props, ...overrides } : props;
}
