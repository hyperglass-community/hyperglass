import { Alert } from '@chakra-ui/react';
import { Component } from 'react';

interface ShareErrorBoundaryProps {
  /** Shown in place of the children when they fail to render. */
  message: string;
  /** Called once the children failed, so the page can hide what came from them. */
  onError?(): void;
  children: React.ReactNode;
}

interface ShareErrorBoundaryState {
  failed: boolean;
}

/**
 * Shows `message` in place of shared results that throw while rendering. It catches only
 * errors thrown during rendering of its children, not those in event handlers, effects or
 * asynchronous code, so it is a second line behind the shape check, not a guarantee. The
 * error itself is never shown.
 */
export class ShareErrorBoundary extends Component<
  ShareErrorBoundaryProps,
  ShareErrorBoundaryState
> {
  state: ShareErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ShareErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onError?.();
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
