import React, { useSyncExternalStore } from 'react';

const bindingKey = Symbol.for('dsh-tavern-mode/component-binding');

export function bindComponent(entry, wrap) {
  let binding = entry.component[bindingKey];
  if (!binding) {
    binding = { current: entry.component, listeners: new Set() };
    binding.subscribe = callback => { binding.listeners.add(callback); return () => binding.listeners.delete(callback); };
    binding.snapshot = () => binding.current;
    function ComponentBinding(props) {
      const Component = useSyncExternalStore(binding.subscribe, binding.snapshot);
      return <Component {...props} />;
    }
    ComponentBinding[bindingKey] = binding;
    entry.component = ComponentBinding;
  }
  const previous = binding.current;
  const current = wrap(previous);
  const publish = component => { binding.current = component; for (const callback of binding.listeners) callback(); };
  publish(current);
  return () => { if (binding.current === current) publish(previous); };
}
