import { Text, Tooltip, Badge, Link } from '@chakra-ui/react';
import { Else, If, Then } from 'react-if';
import {
  TRACEROUTE_BLANK,
  TRACEROUTE_NO_RTT,
  formatHopASN,
  formatHopHostname,
  formatHopRTT,
} from '~/util';

import type { TextProps } from '@chakra-ui/react';

interface MonoFieldProps extends TextProps {
  v: React.ReactNode;
}

interface ASNFieldProps extends TextProps {
  asn: string | null;
  org: string | null;
}

interface HostnameFieldProps extends TextProps {
  hostname: string | null;
}

interface LatencyFieldProps extends TextProps {
  rtt: number | null;
}

interface LossFieldProps extends TextProps {
  loss: number | null;
}

export const MonoField = (props: MonoFieldProps): JSX.Element => {
  const { v, ...rest } = props;

  // Handle empty, null, undefined values and timeout indicators
  if (
    v === null ||
    v === undefined ||
    (typeof v === 'string' && (v.trim() === '' || v === 'None'))
  ) {
    return (
      <Text as="span" fontSize="sm" fontFamily="mono" color="gray.500" {...rest}>
        —
      </Text>
    );
  }

  return (
    <Text as="span" fontSize="sm" fontFamily="mono" {...rest}>
      {v}
    </Text>
  );
};

export const ASNField = (props: ASNFieldProps): JSX.Element => {
  const { asn, org, ...rest } = props;

  // Shared with the copy-to-clipboard text: "12345" or "IXP", or null when missing.
  const asnDisplay = formatHopASN(asn);

  if (asnDisplay === null) {
    return (
      <Text as="span" fontSize="sm" color="gray.500" {...rest}>
        {TRACEROUTE_BLANK}
      </Text>
    );
  }

  // Keep the tooltip labeled as "IXP - <name>" for exchange-point hops.
  const tooltipLabel =
    org && org !== 'None'
      ? asn === 'IXP'
        ? `IXP - ${org}`
        : `${asnDisplay} - ${org}`
      : asnDisplay;

  const isNumericAsn = /^\d+$/.test(asnDisplay);
  const content = isNumericAsn ? (
    <Link
      href={`https://bgp.tools/as/${asnDisplay}`}
      isExternal
      fontSize="sm"
      fontFamily="mono"
      cursor="pointer"
    >
      {asnDisplay}
    </Link>
  ) : (
    <Text as="span" fontSize="sm" fontFamily="mono" cursor="help" {...rest}>
      {asnDisplay}
    </Text>
  );

  return (
    <Tooltip hasArrow label={tooltipLabel} placement="top">
      {content}
    </Tooltip>
  );
};

export const HostnameField = (props: HostnameFieldProps): JSX.Element => {
  const { hostname: rawHostname, ...rest } = props;
  const hostname = formatHopHostname(rawHostname);

  if (hostname === null) {
    return (
      <Text as="span" fontSize="sm" color="gray.500" {...rest}>
        {TRACEROUTE_BLANK}
      </Text>
    );
  }

  return (
    <Tooltip hasArrow label={hostname} placement="top">
      <Text as="span" fontSize="sm" fontFamily="mono" noOfLines={1} maxW="350px" {...rest}>
        {hostname}
      </Text>
    </Tooltip>
  );
};

export const LatencyField = (props: LatencyFieldProps): JSX.Element => {
  const { rtt, ...rest } = props;
  const rttDisplay = formatHopRTT(rtt);

  if (rtt === null || rtt === undefined || rttDisplay === null) {
    return (
      <Text as="span" fontSize="sm" color="gray.500" {...rest}>
        {TRACEROUTE_NO_RTT}
      </Text>
    );
  }

  // Color-code latency: green < 50ms, yellow < 200ms, red >= 200ms
  const getLatencyColor = (latency: number) => {
    if (latency < 50) return 'green.500';
    if (latency < 200) return 'yellow.500';
    return 'red.500';
  };

  return (
    <Text as="span" fontSize="sm" fontFamily="mono" color={getLatencyColor(rtt)} {...rest}>
      {rttDisplay}
    </Text>
  );
};

export const LossField = (props: LossFieldProps): JSX.Element => {
  const { loss, ...rest } = props;

  if (loss === null || loss === undefined) {
    return (
      <Text as="span" fontSize="sm" color="gray.500" {...rest}>
        —
      </Text>
    );
  }

  // Color-code loss: green = 0%, yellow < 50%, red >= 50%
  const getLossColor = (lossPercent: number) => {
    if (lossPercent === 0) return 'green.500';
    if (lossPercent < 50) return 'yellow.500';
    return 'red.500';
  };

  return (
    <Badge
      fontSize="sm"
      fontFamily="mono"
      variant="solid"
      colorScheme={loss === 0 ? 'green' : loss < 50 ? 'yellow' : 'red'}
      {...rest}
    >
      {loss}%
    </Badge>
  );
};
