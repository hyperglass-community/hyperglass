import { Alert } from '@chakra-ui/react';
import { Component } from 'react';

interface ShareErrorBoundaryProps {
  /** Shown in place of the children when they fail to render. */
  message: string;
  children: React.ReactNode;
}

interface ShareErrorBoundaryState {
  failed: boolean;
}

/**
 * Shows `message` in place of shared results that fail to render, so a snapshot the
 * shape check let through (it doesn't check every value) can't take the page down with
 * it. The error itself is never shown.
 */
export class ShareErrorBoundary extends Component<
  ShareErrorBoundaryProps,
  ShareErrorBoundaryState
> {
  state: ShareErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ShareErrorBoundaryState {
    return { failed: true };
  }

  render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <Alert
          status="warning"
          rounded="lg"
          my={4}
          mx="auto"
          w="100%"
          maxW={{ base: '100%', md: '75%' }}
        >
          {this.props.message}
        </Alert>
      );
    }
    return this.props.children;
  }
}
