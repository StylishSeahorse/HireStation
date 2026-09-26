import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorText } from './api';

/** Mutation helper: tracks error text and invalidates the given query keys on success. */
export function useMutate<T, R = any>(fn: (v: T) => Promise<R>, invalidate: unknown[][] = [], onSuccess?: (r: R) => void) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => setError(''),
    onError: (e) => setError(errorText(e)),
    onSuccess: async (r) => { await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))); onSuccess?.(r); },
  });
  return { ...m, error, setError };
}
