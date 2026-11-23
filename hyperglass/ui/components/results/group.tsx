import { Accordion } from '@chakra-ui/react';
import { AnimatePresence } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import { AnimatedDiv } from '~/elements';
import { useFormState } from '~/hooks';
import { Result } from './individual';
import { Tags } from './tags';

interface ResultsViewProps {
  /** The query type and target labels above the results. */
  tags: React.ReactNode;
  /** One result per location, each with a `key`. */
  children: React.ReactNode;
}

/**
 * The layout around a query's results.
 */
export const ResultsView = (props: ResultsViewProps): JSX.Element => {
  const { tags, children } = props;

  // Scroll to the top of the page when results load - primarily for mobile.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
  }, []);

  return (
    <>
      {tags}
      <AnimatedDiv
        p={0}
        my={4}
        w="100%"
        mx="auto"
        rounded="lg"
        textAlign="left"
        borderWidth="1px"
        overflow="hidden"
        initial={{ opacity: 1 }}
        exit={{ opacity: 0, y: 300 }}
        transition={{ duration: 0.3 }}
        animate={{ opacity: 1, y: 0 }}
        maxW={{ base: '100%', md: '75%' }}
      >
        <Accordion allowMultiple>
          <AnimatePresence>{children}</AnimatePresence>
        </Accordion>
      </AnimatedDiv>
    </>
  );
};

/**
 * The live results for the query in the form.
 */
export const Results = (): JSX.Element => {
  const form = useFormState(s => s.form);
  const getDirective = useFormState(s => s.getDirective);
  const { queryLocation } = form;

  const selectedDirective = useMemo(() => {
    return getDirective();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.queryType, getDirective]);

  return (
    <ResultsView
      tags={
        <Tags
          queryLocation={queryLocation}
          queryType={selectedDirective?.name}
          queryTarget={form.queryTarget}
        />
      }
    >
      {queryLocation.length > 0 &&
        queryLocation.map((location, index) => {
          return <Result index={index} key={location} queryLocation={location} />;
        })}
    </ResultsView>
  );
};
