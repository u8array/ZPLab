import { useT } from '../hooks/useT';
import { useLabelStore } from '../store/labelStore';
import { getEntry, isGs1Active } from '@zplab/core/registry';
import { StaticSectionCard } from '../components/Properties/SectionCard';
import { ContentEditorButton } from '../components/Properties/ContentEditorButton';
import { builderButtonCls } from '../components/ui/formStyles';
import type { BindableLeaf } from '@zplab/core/lib/variableField';
import { Gs1BuilderButton } from './gs1PanelControls';

/** Content section for typed-content carriers: inline chip editor plus the
 *  matching builder launcher. GS1 mode gets the GS1 builder; otherwise the
 *  typed-content builder renders exactly when the registry capability
 *  (`typedContent`) says so, keeping the flag and its button in lockstep with
 *  the cross-cutting consumers (marker-value preflight). */
export function TypedContentSection({ obj }: { obj: BindableLeaf }) {
  const t = useT();
  const openContentBuilder = useLabelStore((s) => s.openContentBuilder);
  const gs1 = isGs1Active(getEntry(obj.type), obj.props);
  return (
    <StaticSectionCard title={t.properties.contentSection} cmd="^FD">
      <ContentEditorButton obj={obj} />
      {gs1 ? (
        <Gs1BuilderButton objId={obj.id} />
      ) : getEntry(obj.type)?.typedContent ? (
        <button type="button" onClick={() => openContentBuilder(obj.id)} className={builderButtonCls}>
          {t.contentBuilder.button}
        </button>
      ) : null}
    </StaticSectionCard>
  );
}
