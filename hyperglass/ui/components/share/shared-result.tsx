import { Alert, Box, Button, Flex, HStack, Heading, Spinner, Text, chakra } from '@chakra-ui/react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useId, useRef, useState } from 'react';
import { ReadOnlyResult, ResultsView, Tags } from '~/components';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';
import {
  shareQuery,
  useColorValue,
  useDevice,
  useFormState,
  useHistoryView,
  useShareSnapshot,
  useShareView,
  useStrf,
  withoutPrefill,
  withoutShare,
} from '~/hooks';
import { formatTimestamp } from '~/util';
import { ShareErrorBoundary } from './share-error-boundary';

import type { NextRouter } from 'next/router';
import type { SharedResult as SharedResultData, Snapshot } from '~/hooks';
import type { Device } from '~/types';

/**
 * Replace the address's query string with `search`, through the router, so the history
 * entries Next.js keeps (and Back restores) have the new address too. As the form does
 * for a prefill link: the route is the page's, not the address's path, since the page
 * can also be served as `/index.html`.
 */
function replaceSearch(router: NextRouter, search: string): void {
  const { pathname, search: current, hash } = window.location;
  if (search !== current) {
    router.replace(`${router.pathname}${search}`, `${pathname}${search}${hash}`, {
      shallow: true,
      scroll: false,
    });
  }
}

/** The shared result's variables as `<variable name>: <option name>`, as configured now. */
function variableLabels(result: SharedResultData, getDevice: (id: string) => Device | null) {
  const { location, queryType, queryTypeName, variables } = result.query;
  const directives = getDevice(location)?.directives ?? [];
  const directive =
    directives.find(d => d.id === queryType) ?? directives.find(d => d.name === queryTypeName);
  return Object.entries(variables).map(([id, value]) => {
    const variable = directive?.variables?.find(v => v.id === id);
    const option = variable?.options.find(o => o.value === value);
    return `${variable?.name ?? id}: ${option?.name ?? value}`;
  });
}

/** The response a result panel renders, from a shared result. */
function sharedResponse(id: string, result: SharedResultData): QueryResponse {
  return {
    id,
    random: '',
    cached: false,
    runtime: result.runtime,
    level: 'success',
    timestamp: result.timestamp,
    keywords: [],
    output: result.output,
    format: result.format,
    enrichment: 'complete',
  };
}

interface SnapshotViewProps {
  snapshot: Snapshot;
}

/** The shared results, read-only, as the results view shows live ones. */
const SnapshotView = (props: SnapshotViewProps): JSX.Element => {
  const { snapshot } = props;
  const getDevice = useDevice();
  const [first] = snapshot.results;
  const queryTarget = Array.isArray(first.query.target) ? first.query.target : [first.query.target];
  const displayTarget = queryTarget.join(', ');
  const variables = variableLabels(first, getDevice);
  const muted = useColorValue('gray.600', 'gray.400');
  return (
    <>
      {variables.length > 0 && (
        <Text fontSize="sm" color={muted} overflowWrap="anywhere">
          {variables.join(', ')}
        </Text>
      )}
      <ResultsView
        // Every shared result is complete: show them all.
        defaultIndex={snapshot.results.map((_, index) => index)}
        tags={
          <Tags
            queryLocation={snapshot.results.map(r => r.query.location)}
            queryType={first.labels.queryType}
            queryTarget={queryTarget}
          />
        }
      >
        {snapshot.results.map((result, index) => (
          <ReadOnlyResult
            // biome-ignore lint/suspicious/noArrayIndexKey: the results never change order.
            key={index}
            index={index}
            location={{ id: result.query.location, name: result.labels.location }}
            data={sharedResponse(snapshot.id, result)}
            queryTarget={queryTarget}
            displayTarget={displayTarget}
          />
        ))}
      </ResultsView>
    </>
  );
};

/**
 * The shared result of the address's `share` parameter, read-only, in place of the form:
 * one `GET /api/share/<id>`, and nothing else is requested. Copy is allowed; there is no
 * requery, polling or AS path lookup. **Run this query** fills the form with the shared
 * query for the visitor to submit; **New query** shows an empty form.
 *
 * The link's other parameters (a prefilled form) are ignored and removed from the address,
 * so a link can't pair a real snapshot with a form someone else filled in.
 */
export const SharedResult = (): JSX.Element | null => {
  const { web, messages } = useConfig();
  const strF = useStrf();
  const router = useRouter();
  const muted = useColorValue('gray.600', 'gray.400');
  const id = useShareView(s => s.id);
  const outcome = useShareSnapshot(id ?? '');
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The loading text goes into its live region after the region is rendered: a region
  // that appears with its text already in it isn't announced.
  const [announce, setAnnounce] = useState(false);
  // The results failed to render (see `ShareErrorBoundary`): nothing from them is shown.
  const [renderFailed, setRenderFailed] = useState(false);

  // Move focus to the view that replaced the form, and fill the live region.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    setAnnounce(true);
  }, []);

  // Remove the prefill parameters from the address once the router is ready (see
  // `LookingGlassForm`, which ignores them while `share` is there).
  const cleaned = useRef(false);
  useEffect(() => {
    if (!router.isReady || cleaned.current) {
      return;
    }
    cleaned.current = true;
    replaceSearch(router, withoutPrefill(window.location.search));
  }, [router.isReady]);

  if (id === null) {
    return null;
  }

  /** Close the shared result and remove it, and any prefill, from the address. */
  function leave(): void {
    replaceSearch(router, withoutPrefill(withoutShare(window.location.search)));
    useShareView.getState().close();
  }

  function handleRun(snapshot: Snapshot): void {
    // The form takes it once it mounts, fills itself and focuses Submit (or the first
    // field it couldn't fill); the visitor submits, so the greeting applies.
    const { query, locations } = shareQuery(snapshot);
    useHistoryView.getState().prefill(query, locations);
    leave();
  }

  function handleNew(): void {
    void useFormState.getState().reset();
    leave();
    // The button goes away with the shared result: focus the page, as the history list
    // does once it goes away.
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
  }

  const newQuery = (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleNew}
      leftIcon={<DynamicIcon icon={{ fi: 'FiPlus' }} boxSize="16px" />}
    >
      {web.text.shareNewQuery}
    </Button>
  );

  const errorText =
    outcome.status === 'notFound'
      ? messages.shareNotFound
      : outcome.status === 'unsupported'
        ? messages.shareUnsupported
        : outcome.status === 'rateLimited'
          ? messages.rateLimited
          : web.text.shareError;

  return (
    <chakra.section aria-labelledby={headingId} w="100%">
      <Head>
        <meta key="robots" name="robots" content="noindex" />
      </Head>
      <Flex
        mt={4}
        w="100%"
        mx="auto"
        gap={2}
        align="center"
        flexWrap="wrap"
        justify="space-between"
        maxW={{ base: '100%', md: '75%' }}
      >
        <Box textAlign="left" minW={0}>
          <Heading
            as="h2"
            id={headingId}
            ref={headingRef}
            size="md"
            tabIndex={-1}
            _focus={{ outline: 'none' }}
          >
            {web.text.shareTitle}
          </Heading>
          {outcome.status === 'found' && (
            <>
              {!renderFailed && (
                <Text fontSize="sm" color={muted}>
                  {strF(web.text.shareResultTime, {
                    time: formatTimestamp(outcome.snapshot.results[0].timestamp),
                  })}
                </Text>
              )}
              <Text fontSize="sm" color={muted}>
                {strF(web.text.shareExpires, {
                  time: formatTimestamp(outcome.snapshot.expiresAt),
                })}
              </Text>
            </>
          )}
        </Box>
        <HStack spacing={2} flexWrap="wrap">
          {outcome.status === 'found' && !renderFailed && (
            <Button
              size="sm"
              variant="ghost"
              colorScheme="secondary"
              onClick={() => handleRun(outcome.snapshot)}
              leftIcon={<DynamicIcon icon={{ fi: 'FiRepeat' }} boxSize="16px" />}
            >
              {web.text.shareRunQuery}
            </Button>
          )}
          {newQuery}
        </HStack>
      </Flex>
      {outcome.status === 'loading' && (
        <HStack justify="center" spacing={3} my={8}>
          {/* The text says it: no label of the spinner's own, which isn't configurable. */}
          <Spinner size="sm" label="" aria-hidden />
          <Text role="status">{announce ? web.text.shareLoading : null}</Text>
        </HStack>
      )}
      {outcome.status === 'found' && (
        <ShareErrorBoundary message={web.text.shareError} onError={() => setRenderFailed(true)}>
          <SnapshotView snapshot={outcome.snapshot} />
        </ShareErrorBoundary>
      )}
      {outcome.status !== 'loading' && outcome.status !== 'found' && (
        <Alert
          status="warning"
          rounded="lg"
          my={4}
          mx="auto"
          w="100%"
          maxW={{ base: '100%', md: '75%' }}
        >
          {errorText}
        </Alert>
      )}
    </chakra.section>
  );
};
