import {
  AccordionButton,
  AccordionItem,
  AccordionPanel,
  Alert,
  Box,
  Flex,
  HStack,
  Tooltip,
  chakra,
  useAccordionContext,
  useToast,
} from '@chakra-ui/react';
import { motion } from 'framer-motion';
import startCase from 'lodash/startCase';
import { forwardRef, memo, useEffect, useMemo, useState } from 'react';
import isEqual from 'react-fast-compare';
import { Else, If, Then } from 'react-if';
import { BGPTable, TracerouteTable, Path, TextOutput } from '~/components';
import { useConfig } from '~/context';
import { Countdown, DynamicIcon } from '~/elements';
import {
  directiveRetains,
  useColorValue,
  useDevice,
  useFormState,
  useLGQuery,
  useMobile,
  useRecordHistory,
  useStrf,
  useTableToString,
} from '~/hooks';
import {
  isStringOutput,
  isStructuredOutput,
  isBGPStructuredOutput,
  isTracerouteStructuredOutput,
} from '~/types';
import { formatTimestamp } from '~/util';
import { CopyButton } from './copy-button';
import { FormattedError } from './formatted-error';
import { isFetchError, isLGError, isLGOutputOrError, isQueryError, isStackError } from './guards';
import { ResultHeader } from './header';
import { RequeryButton, RequeryCountdown, useRequeryCooldown } from './requery-button';
import { ResultShareButton } from './share-button';

import type { ErrorLevels } from '~/types';

interface ResultProps {
  index: number;
  queryLocation: string;
}

/**
 * The state of one location's query that a result renders. The result of `useLGQuery`
 * has this shape.
 */
export interface ResultQueryState {
  data: QueryResponse | undefined;
  /** The request's error, or `null` when there is none, as for a stored result. */
  error: Response | QueryResponse | Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isFetchedAfterMount: boolean;
}

/** What the header buttons of a result depend on. */
export interface ResultButtonsState {
  data: QueryResponse | undefined;
  /** The text the copy button copies. */
  copyValue: string;
  isQuerying: boolean;
  /** The response has a structured table, so it has an AS path to show. */
  showPath: boolean;
}

export interface ResultPanelProps {
  index: number;
  /** The device the result is from. `name` is the header's title. */
  location: { id: string; name: string };
  /** The query target, used to format structured output for the copy button. */
  queryTarget: string[];
  query: ResultQueryState;
  errorLevel: ErrorLevels;
  /**
   * Renders the buttons next to the result's header. It is called on every render, like a
   * component body, so it must not call hooks; render components that need them instead,
   * as `Result` does with `FormPath`.
   */
  buttons(state: ResultButtonsState): React.ReactNode;
  /**
   * A short line under the header, such as the requery button's countdown. Kept out of the
   * header's row so it doesn't widen it on narrow screens.
   */
  notice?: React.ReactNode;
}

const AnimatedAccordionItem = motion(AccordionItem);

const AccordionHeaderWrapper = chakra('div', {
  baseStyle: {
    display: 'flex',
    justifyContent: 'space-between',
    _hover: { bg: 'blackAlpha.50' },
    _focus: { boxShadow: 'outline' },
  },
});

const _Result: React.ForwardRefRenderFunction<HTMLDivElement, ResultProps> = (
  props: ResultProps,
  ref,
) => {
  const { index, queryLocation } = props;
  const toast = useToast();
  const { messages, share } = useConfig();
  const getDevice = useDevice();
  const device = getDevice(queryLocation);

  const addResponse = useFormState(s => s.addResponse);
  const form = useFormState(s => s.form);
  const getDirective = useFormState(s => s.getDirective);
  const [errorLevel, _setErrorLevel] = useState<ErrorLevels>('error');

  const setErrorLevel = (level: ResponseLevel): void => {
    let e: ErrorLevels = 'error';
    switch (level) {
      case 'success':
        e = level;
        break;
      case 'warning':
        e = 'warning';
        break;
    }
    _setErrorLevel(e);
  };

  const query = useLGQuery(
    {
      queryLocation,
      queryTarget: form.queryTarget,
      queryType: form.queryType,
      queryVariables: form.queryVariables,
    },
    {
      onSuccess(data) {
        if (device !== null) {
          addResponse(device.id, data);
        }
        if (isLGOutputOrError(data)) {
          console.error(data);
          setErrorLevel(data.level);
        }
      },
      onError(error) {
        console.error({ error });
        if (isLGOutputOrError(error)) {
          setErrorLevel(error.level);
        }
      },
    },
  );

  const isError = isQueryError(query.data, query.error);
  // Save a successful response to the query history.
  useRecordHistory(queryLocation, query.data, isError);
  const cooldown = useRequeryCooldown(query.requery, query.refreshAt);

  // Whether this location's directive lets its results be kept (`retain`), checked as the
  // history does, which is at least as strict as the server (see `directiveRetains`).
  const retains = useMemo(() => {
    if (device === null) {
      return false;
    }
    const queryTypeName = getDirective()?.name ?? form.queryType;
    return directiveRetains(device, { queryType: form.queryType, queryTypeName }) === true;
  }, [device, form.queryType, getDirective]);
  // Offer a share only for a result the server would share: a success whose enrichment
  // has finished, from a directive that retains its results.
  const shareable =
    share.enable &&
    retains &&
    !isError &&
    query.data !== undefined &&
    query.data.enrichment !== 'pending';

  if (device === null) {
    const id = `toast-queryLocation-${index}-${queryLocation}`;
    if (!toast.isActive(id)) {
      toast({
        id,
        title: messages.general,
        description: `Configuration for device with ID '${queryLocation}' not found.`,
        status: 'error',
        isClosable: true,
      });
    }
    return <></>;
  }

  return (
    <ResultPanel
      ref={ref}
      index={index}
      location={device}
      queryTarget={form.queryTarget}
      // `useLGQuery` declares its error as `unknown`, but its query is typed with this
      // error union, and React Query sets `error` to `null` when there is none.
      query={query as ResultQueryState}
      errorLevel={errorLevel}
      notice={
        cooldown.until !== null && <RequeryCountdown key={cooldown.until} until={cooldown.until} />
      }
      buttons={({ data, copyValue, isQuerying, showPath }) => (
        <>
          {showPath && <FormPath device={device.id} />}
          <CopyButton copyValue={copyValue} isDisabled={isQuerying} />
          <RequeryButton
            requery={cooldown.requery}
            announcement={cooldown.announcement}
            isDisabled={isQuerying}
          />
          {shareable && data !== undefined && (
            <ResultShareButton
              queryId={data.id}
              timestamp={data.timestamp}
              isDisabled={isQuerying}
            />
          )}
        </>
      )}
    />
  );
};

const _ResultPanel: React.ForwardRefRenderFunction<HTMLDivElement, ResultPanelProps> = (
  props: ResultPanelProps,
  ref,
) => {
  const { index, location, queryTarget, query, errorLevel, buttons, notice } = props;
  const { web, cache, messages } = useConfig();
  const { index: indices, setIndex } = useAccordionContext();

  const isMobile = useMobile();
  const color = useColorValue('black', 'white');
  const scrollbar = useColorValue('blackAlpha.300', 'whiteAlpha.300');
  const scrollbarHover = useColorValue('blackAlpha.400', 'whiteAlpha.400');
  const scrollbarBg = useColorValue('blackAlpha.50', 'whiteAlpha.50');

  const { data, error, isLoading, isFetching, isFetchedAfterMount } = query;

  const isQuerying = isLoading || isFetching;
  const isError = useMemo(() => isQueryError(data, error), [data, error]);

  const isCached = useMemo(() => data?.cached || !isFetchedAfterMount, [data, isFetchedAfterMount]);

  const strF = useStrf();
  const cacheLabel = strF(web.text.cacheIcon, {
    time: data?.timestamp ? formatTimestamp(data.timestamp) : '',
  });

  const errorKeywords = useMemo(() => {
    let kw = [] as string[];
    if (isLGError(data)) {
      kw = data.keywords;
    }
    return kw;
  }, [data]);

  // Parse the the response and/or the error to determine from where to extract the error message.
  const errorMsg = useMemo(() => {
    if (isLGError(error)) {
      return error.output as string;
    }
    if (isLGOutputOrError(data)) {
      return data.output as string;
    }
    if (isFetchError(error)) {
      return startCase(error.statusText);
    }
    // `fetchWithTimeout` aborts a request once `requestTimeout` passes, and `fetch` then
    // rejects with an `AbortError` whose message doesn't mention the timeout.
    if (
      isStackError(error) &&
      (error.name === 'AbortError' || error.message.toLowerCase().startsWith('timeout'))
    ) {
      return messages.requestTimeout;
    }
    if (isStackError(error)) {
      return startCase(error.message);
    }
    return messages.general;
  }, [error, data, messages.general, messages.requestTimeout]);

  const tableComponent = useMemo<boolean>(() => {
    let result = false;
    if (data?.format === 'application/json') {
      result = true;
    }
    return result;
  }, [data?.format]);

  let copyValue = data?.output as string;

  // Always create formatData hook for both BGP and Traceroute outputs
  const formatData = useTableToString(queryTarget, data, [data?.format]);
  const isBGPData = isBGPStructuredOutput(data);
  const isTracerouteData = isTracerouteStructuredOutput(data);

  if (data?.format === 'application/json' && isBGPData) {
    copyValue = formatData();
  } else if (data?.format === 'application/json' && isTracerouteData) {
    // For structured traceroute, use formatted table output for copy functionality
    copyValue = formatData();
  }

  if (error) {
    copyValue = errorMsg;
  }

  // Signal to the group that this result is done loading.
  useEffect(() => {
    // Only set the index if it's not already set and the query is finished loading.
    if (Array.isArray(indices) && indices.length === 0 && !isQuerying) {
      // Only set the index if the response has data or an error.
      if (data || isError) {
        setIndex([index]);
      }
    }
  }, [data, index, indices, isQuerying, isError, setIndex]);

  return (
    <AnimatedAccordionItem
      ref={ref}
      id={location.id}
      isDisabled={isQuerying}
      exit={{ opacity: 0, y: 300 }}
      animate={{ opacity: 1, y: 0 }}
      initial={{ opacity: 0, y: 300 }}
      transition={{ duration: 0.3, delay: index * 0.3 }}
      css={{
        '&:first-of-type': { borderTop: 'none' },
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <AccordionHeaderWrapper>
        {/* Shrinks, wrapping a long device name, so the buttons stay in view on a narrow
        screen instead of widening the row past the results box, which clips it. */}
        {/* Tighter on a phone, with the buttons closer together below: with four buttons
        (AS path, copy, requery, share) a long name otherwise gets too little width to wrap
        between words at 360px. */}
        <AccordionButton
          py={2}
          px={{ base: 2, sm: 4 }}
          w="unset"
          _hover={{}}
          _focus={{}}
          flex="1 1 auto"
          minW={0}
        >
          <ResultHeader
            isError={isError}
            loading={isQuerying}
            errorMsg={errorMsg}
            errorLevel={errorLevel}
            runtime={data?.runtime ?? 0}
            title={location.name}
          />
        </AccordionButton>
        <HStack py={2} pr={{ base: 1, sm: 0 }} spacing={{ base: 0, sm: 1 }}>
          {buttons({
            data,
            copyValue,
            isQuerying,
            showPath: isStructuredOutput(data) && data.level === 'success' && tableComponent,
          })}
        </HStack>
      </AccordionHeaderWrapper>
      {notice && (
        <Flex px={4} pb={2} justifyContent="flex-end" textAlign="right">
          {notice}
        </Flex>
      )}
      <AccordionPanel
        pb={4}
        overflowX="auto"
        css={{
          WebkitOverflowScrolling: 'touch',
          '&::-webkit-scrollbar': { height: '5px' },
          '&::-webkit-scrollbar-track': {
            backgroundColor: scrollbarBg,
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: scrollbar,
          },
          '&::-webkit-scrollbar-thumb:hover': {
            backgroundColor: scrollbarHover,
          },

          '-ms-overflow-style': { display: 'none' },
        }}
      >
        <Box>
          <Flex direction="column" flex="1 0 auto" maxW={error ? '100%' : undefined}>
            <If condition={!isError && typeof data !== 'undefined'}>
              <Then>
                {isBGPStructuredOutput(data) && data.level === 'success' && tableComponent ? (
                  <BGPTable>{data.output}</BGPTable>
                ) : isTracerouteStructuredOutput(data) &&
                  data.level === 'success' &&
                  tableComponent ? (
                  <TracerouteTable>{data.output}</TracerouteTable>
                ) : isStringOutput(data) && data.level === 'success' && !tableComponent ? (
                  <TextOutput>{data.output}</TextOutput>
                ) : isStringOutput(data) && data.level !== 'success' ? (
                  <Alert rounded="lg" my={2} py={4} status={errorLevel} variant="solid">
                    <FormattedError message={data.output} keywords={errorKeywords} />
                  </Alert>
                ) : (
                  <Alert rounded="lg" my={2} py={4} status={errorLevel} variant="solid">
                    <FormattedError message={errorMsg} keywords={errorKeywords} />
                  </Alert>
                )}
              </Then>
              <Else>
                <Alert rounded="lg" my={2} py={4} status={errorLevel} variant="solid">
                  <FormattedError message={errorMsg} keywords={errorKeywords} />
                </Alert>
              </Else>
            </If>
          </Flex>
        </Box>

        <Flex direction="row" flexWrap="wrap">
          <HStack
            px={3}
            mt={2}
            spacing={1}
            flex="1 0 auto"
            justifyContent={{ base: 'flex-start', lg: 'flex-end' }}
          >
            <If condition={cache.showText && !isError && isCached}>
              <Then>
                <If condition={isMobile}>
                  <Then>
                    <Countdown timeout={cache.timeout} text={web.text.cachePrefix} />
                    <Tooltip hasArrow label={cacheLabel} placement="top">
                      <Box>
                        <DynamicIcon icon={{ bs: 'BsLightningFill' }} color={color} />
                      </Box>
                    </Tooltip>
                  </Then>
                  <Else>
                    <Tooltip hasArrow label={cacheLabel} placement="top">
                      <Box>
                        <DynamicIcon icon={{ bs: 'BsLightningFill' }} color={color} />
                      </Box>
                    </Tooltip>
                    <Countdown timeout={cache.timeout} text={web.text.cachePrefix} />
                  </Else>
                </If>
              </Then>
            </If>
          </HStack>
        </Flex>
      </AccordionPanel>
    </AnimatedAccordionItem>
  );
};

/**
 * One result, rendered from props: it makes no request and doesn't use the form state or
 * the device configuration. It must be inside an `Accordion`. The buttons it is given may
 * do either.
 */
export const ResultPanel = forwardRef<HTMLDivElement, ResultPanelProps>(_ResultPanel);

/**
 * The AS path of the response stored in the form state for `device`. Looks up ASN
 * organizations when opened and stores the enriched response.
 */
const FormPath = (props: { device: string }): JSX.Element => {
  const { device } = props;
  const displayTarget = useFormState(s => s.target.display);
  const getResponse = useFormState(s => s.response);
  const response = getResponse(device);
  const addResponse = useFormState(s => s.addResponse);
  return (
    <Path
      response={response}
      displayTarget={displayTarget}
      onEnriched={enriched => addResponse(device, enriched)}
    />
  );
};

/**
 * The live result for one location: runs the query for the form's values, stores the
 * response in the form state and can run it again.
 */
export const Result = memo(forwardRef<HTMLDivElement, ResultProps>(_Result), isEqual);
