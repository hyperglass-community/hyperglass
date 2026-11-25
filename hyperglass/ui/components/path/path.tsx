import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Skeleton,
  useDisclosure,
} from '@chakra-ui/react';
import 'reactflow/dist/style.css';
import { useBreakpointValue, useColorValue, useStrf } from '~/hooks';
import { useConfig } from '~/context';
import { Chart } from './chart';
import { PathButton } from './path-button';

export interface PathProps {
  /** The response whose AS path to chart. */
  response: QueryResponse | null;
  /** The query target as the user typed it, shown in the modal title. */
  displayTarget: string;
  /**
   * Receives `response` with the ASN organizations looked up when the modal opens. Without
   * it, nothing is looked up: no request to `/api/aspath/enrich` is made.
   */
  onEnriched?(response: QueryResponse): void;
}

/**
 * The AS path button and modal for one response.
 */
export const Path = (props: PathProps): JSX.Element => {
  const { response, displayTarget, onEnriched } = props;
  const { web } = useConfig();
  const strF = useStrf();
  const { isOpen, onClose, onOpen } = useDisclosure();
  const output = response?.output as AllStructuredResponses;
  const bg = useColorValue('light.50', 'dark.900');
  const centered = useBreakpointValue({ base: false, lg: true }) ?? true;
  return (
    <>
      <PathButton
        onOpen={async () => {
          // When opening the AS path modal, attempt on-demand ASN enrichment
          // if the response does not already contain ASN organization data.
          try {
            onOpen();
            if (!onEnriched) return;
            if (!web.aspathEnrichment) return;
            if (!response) return;
            const out = response.output;
            if (typeof out === 'string') return;
            const asnOrgs = out.asn_organizations || {};
            if (Object.keys(asnOrgs).length > 0) return;

            // Collect unique ASNs from the output depending on type
            let asns: string[] = [];
            if ('routes' in out) {
              const all = out.routes.flatMap(route => route.as_path);
              asns = Array.from(new Set(all.map(asn => String(asn))));
            } else if ('hops' in out) {
              const all = out.hops.map(hop => hop.asn).filter((asn): asn is string => Boolean(asn));
              asns = Array.from(new Set(all.map(asn => String(asn))));
            }

            if (asns.length === 0) return;

            const resp = await fetch('/api/aspath/enrich', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ as_path: asns.slice(0, 64) }),
            });
            if (!resp.ok) return;
            const j = await resp.json();
            if (j?.success && j.asn_organizations) {
              // Merge ASN orgs into the stored response and update state
              out.asn_organizations = { ...(out.asn_organizations || {}), ...j.asn_organizations };
              onEnriched({ ...response, output: out });
            }
          } catch (e) {
            // Ignore enrichment failures
            console.debug('AS path enrichment failed', e);
            onOpen();
          }
        }}
      />
      <Modal isOpen={isOpen} onClose={onClose} size="full" isCentered={centered}>
        <ModalOverlay />
        <ModalContent
          bg={bg}
          minH={{ lg: '80vh' }}
          maxH={{ base: '80%', lg: '60%' }}
          maxW={{ base: '100%', lg: '80%' }}
        >
          <ModalHeader>{strF(web.text.asPathTitle, { target: displayTarget })}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Skeleton isLoaded={response != null}>
              <Chart data={output} />
            </Skeleton>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};
