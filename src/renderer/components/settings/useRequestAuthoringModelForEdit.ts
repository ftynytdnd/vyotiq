import { useEffect } from 'react';
import { useComposerModelBridgeStore } from '../../store/useComposerModelBridgeStore.js';

/** When a harness/skills edit panel mounts, request composer switch to authoring model. */
export function useRequestAuthoringModelForEdit(): void {
  const request = useComposerModelBridgeStore((s) => s.requestAuthoringModelForEdit);

  useEffect(() => {
    request();
  }, [request]);
}
