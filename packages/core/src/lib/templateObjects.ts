// Subtree-wide template-marker rewrites: the object-graph twin of fnTemplate's
// per-string helpers. Shared so the editor's variable rename/delete and the MCP
// server's patch ops cannot drift apart.

import { isGroup, type LabelObject } from '../types/Group';
import { renameTemplateMarkers, substituteTemplateMarker } from './fnTemplate';
import { getObjectStringContent } from './variableBinding';

/** Apply `fn` to every leaf's `content` in a subtree. Identity-preserving on
 *  no change, so downstream memoisation survives an edit that touched nothing. */
function mapLeafContent(
  objects: LabelObject[],
  fn: (content: string) => string,
): LabelObject[] {
  let changed = false;
  const next = objects.map((obj) => {
    if (isGroup(obj)) {
      const nextChildren = mapLeafContent(obj.children, fn);
      if (nextChildren === obj.children) return obj;
      changed = true;
      return { ...obj, children: nextChildren };
    }
    const content = getObjectStringContent(obj);
    if (content === undefined) return obj;
    const mapped = fn(content);
    if (mapped === content) return obj;
    changed = true;
    const props = (obj as { props: object }).props;
    return { ...obj, props: { ...props, content: mapped } } as LabelObject;
  });
  return changed ? next : objects;
}

/** Rename one marker across a subtree (see rewriteTemplateMarkersMap). */
export function rewriteTemplateMarkers(
  objects: LabelObject[],
  oldName: string,
  newName: string,
): LabelObject[] {
  return rewriteTemplateMarkersMap(objects, new Map([[oldName, newName]]));
}

/** Rename many names in ONE pass per leaf, each looked up against the original
 *  name: order-independent and collision-safe (swaps/chains can't cascade). */
export function rewriteTemplateMarkersMap(
  objects: LabelObject[],
  renames: ReadonlyMap<string, string>,
): LabelObject[] {
  if (renames.size === 0) return objects;
  return mapLeafContent(objects, (content) => renameTemplateMarkers(content, renames));
}

/** Replace every `«name»` marker with `replacement` across a subtree's leaf
 *  `content`. Used on variable deletion. */
export function substituteTemplateMarkers(
  objects: LabelObject[],
  name: string,
  replacement: string,
): LabelObject[] {
  return mapLeafContent(objects, (content) => substituteTemplateMarker(content, name, replacement));
}
