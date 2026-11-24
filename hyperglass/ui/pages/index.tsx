import dynamic from 'next/dynamic';
import { AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { If, Then, Else } from 'react-if';
import { Loading } from '~/elements';
import { shareParam, useHistoryView, useShareView, useView } from '~/hooks';

import type { NextPage } from 'next';

const LookingGlassForm = dynamic<Dict>(
  () => import('~/components/looking-glass-form').then(i => i.LookingGlassForm),
  {
    loading: Loading,
  },
);

const Results = dynamic<Dict>(() => import('~/components/results').then(i => i.Results), {
  loading: Loading,
});

// Query history is in this browser's storage only: render it on the client only, so the
// prerendered page never has markup that hydration would have to replace.
const RecentQueries = dynamic<Dict>(
  () => import('~/components/history').then(i => i.RecentQueries),
  { ssr: false },
);

const HistoryResults = dynamic<Dict>(
  () => import('~/components/history').then(i => i.HistoryResults),
  { ssr: false, loading: Loading },
);

// A shared result comes from the address, which the prerendered page doesn't have.
const SharedResult = dynamic<Dict>(() => import('~/components/share').then(i => i.SharedResult), {
  ssr: false,
  loading: Loading,
});

const Index: NextPage = () => {
  const view = useView();
  const historyOpen = useHistoryView(s => s.openId !== null);
  const shareOpen = useShareView(s => s.id !== null);

  // A share link (`/?share=<id>`) shows its result in place of the form. Read once the
  // page has mounted, so hydration renders what the prerendered page has; the form
  // ignores its prefill parameters while `share` is in the address.
  useEffect(() => {
    const id = shareParam(window.location.search);
    if (id !== null) {
      useShareView.getState().open(id);
    }
  }, []);

  return (
    <If condition={shareOpen}>
      <Then>
        <SharedResult />
      </Then>
      <Else>
        <If condition={view === 'results'}>
          <Then>
            <Results />
          </Then>
          <Else>
            <If condition={historyOpen}>
              <Then>
                <HistoryResults />
              </Then>
              <Else>
                <AnimatePresence>
                  <LookingGlassForm />
                </AnimatePresence>
                <RecentQueries />
              </Else>
            </If>
          </Else>
        </If>
      </Else>
    </If>
  );
};

export default Index;
