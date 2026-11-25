import { Accordion, Box } from '@chakra-ui/react';
import { AnimatePresence } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import { AnimatedDiv } from '~/elements';
import { prefillLink, queryPrefill, useFormState } from '~/hooks';
import { CopyLinkButton } from './copy-link-button';
import { Result } from './individual';
import { Tags } from './tags';

interface ResultsViewProps {
  /** The query type and target labels above the results. */
  tags: React.ReactNode;
  /** Controls for the whole query, between the tags and the results. */
  actions?: React.ReactNode;
  /** One result per location, each with a `key`. */
  children: React.ReactNode;
  /**
   * The results expanded at first. Without it, the first result to settle expands.
   */
  defaultIndex?: number[];
}

/**
 * The layout around a query's results.
 */
export const ResultsView = (props: ResultsViewProps): JSX.Element => {
  const { tags, actions, children, defaultIndex } = props;

  // Scroll to the top of the page when results load - primarily for mobile.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
  }, []);

  return (
    <>
      {tags}
      {actions !== undefined && (
        <Box w="100%" mx="auto" maxW={{ base: '100%', md: '75%' }}>
          {actions}
        </Box>
      )}
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
        <Accordion allowMultiple defaultIndex={defaultIndex}>
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
    // form.queryType only triggers a re-run: getDirective() reads it from the store.
  }, [form.queryType, getDirective]);

  // A link that fills in the form with this query, on this page. Built in the browser
  // from the page's own address, so it works behind a reverse proxy or under a sub-path.
  const link = useMemo(
    () =>
      typeof window === 'undefined'
        ? ''
        : prefillLink(queryPrefill(form, selectedDirective), window.location),
    [form, selectedDirective],
  );

  return (
    <ResultsView
      // Keyed by the link, so a confirmation or field never shows for another link.
      actions={<CopyLinkButton key={link} link={link} />}
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
