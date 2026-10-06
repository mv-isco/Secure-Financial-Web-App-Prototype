/**
 * useAccounts
 *
 * Fetches all accounts + balances for the authenticated user.
 * Re-fetches whenever `refreshKey` changes (call `refresh()` after a transfer).
 *
 * Returns:
 *   accounts      — AccountRecord[]
 *   totalBalance  — number
 *   loading       — boolean
 *   error         — Error | null
 *   refresh       — () => void   — trigger a manual re-fetch
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAccounts } from '../api/accountsApi';

export function useAccounts() {
  const [accounts,     setAccounts]     = useState([]);
  const [totalBalance, setTotalBalance] = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [refreshKey,   setRefreshKey]   = useState(0);
  const [updatedAt,setUpdatedAt]=useState(null);

  const abortRef = useRef(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    // Cancel any in-flight request from a previous render
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;

    async function fetchAccounts() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAccounts(controller.signal);
        if (!cancelled) {
          setAccounts(data.accounts   || []);
          setTotalBalance(data.totalBalance ?? 0);
          setUpdatedAt(new Date());
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAccounts();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [refreshKey]);

  return { accounts, totalBalance, loading, error, refresh, updatedAt };
}
