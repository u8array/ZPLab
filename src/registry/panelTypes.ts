import type React from 'react';
import type { LabelObjectBase } from '@zplab/core/types/LabelObject';
import type { LeafType, PropsFor } from '@zplab/core/registry/leafObject';

/** UI half of a registry entry. Lives beside panels.ts, NOT in types/, so the
 *  domain type graph stays React-free (registry-isolation.test tripwires it). */
export interface ObjectTypeUi<P extends object = object> {
  PropertiesPanel: React.ComponentType<{
    obj: LabelObjectBase & { props: P };
    onChange: (props: Partial<P>) => void;
    /** The object or a group above it is locked, so the store refuses every props write. */
    locked?: boolean;
  }>;
}

/** Type-safe ObjectPanels shape: each key carries the matching Ui entry. */
export type ObjectPanelsMap = { [T in LeafType]: ObjectTypeUi<PropsFor<T>> };
