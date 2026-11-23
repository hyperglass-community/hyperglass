import dynamic from 'next/dynamic';
import { AnimatePresence } from 'framer-motion';
import { If, Then, Else } from 'react-if';
import { Loading } from '~/elements';
import { useQueryHistory, useView } from '~/hooks';

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

const Index: NextPage = () => {
  const view = useView();
  const historyOpen = useQueryHistory(s => s.openId !== null);
  return (
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
  );
};

export default Index;
