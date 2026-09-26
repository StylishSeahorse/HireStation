import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api('/settings'), retry: false, staleTime: 60_000 });
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me'), retry: false });
export const useSetupStatus = () => useQuery({ queryKey: ['setup-status'], queryFn: () => api<{ needsSetup: boolean; hasAdmin: boolean }>('/setup/status') });
