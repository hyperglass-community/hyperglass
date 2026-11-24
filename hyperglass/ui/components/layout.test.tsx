import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { useFormState, useHistoryView, useQueryHistory } from '~/hooks';
import { Layout } from './layout';

// The page chrome has its own tests (or will); stub it so these tests cover what
// `Layout` does: arrange the page, keep browser history in step with the view, and
// return to the form. `ResetButton` stays real, since `Layout` drives it.
vi.mock('~/components', async importOriginal => ({
  ...(await importOriginal<typeof import('~/components')>()),
  Debugger: () => <div data-testid="debugger" />,
  Footer: () => <footer data-testid="footer" />,
  Greeting: () => <div data-testid="greeting" />,
  Header: () => <header data-testid="header" />,
}));

const initialFormState = useFormState.getState();
const { scrollIntoView } = Element.prototype;

const form = {
  queryLocation: ['router_one'],
  queryTarget: ['192.0.2.0/24'],
  queryType: '__hyperglass_juniper_bgp_route__',
  queryVariables: {},
};

function renderLayout(developerMode = false) {
  return renderWithProviders(
    <Layout>
      <p>page content</p>
    </Layout>,
    { config: makeConfig({ developerMode }) },
  );
}

/** The reset button, which only shows on the results view. Its icon loads asynchronously. */
async function resetButton(): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name: 'Reset' });
  await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  return button;
}

beforeEach(() => {
  window.history.replaceState(null, '');
  // framer-motion measures layout with `window.scrollTo`, and the reset handler scrolls
  // the page container; jsdom implements neither.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => {
    useFormState.setState(initialFormState, true);
    useQueryHistory.setState({ entries: [] });
    useHistoryView.setState({ openId: null, returnFocusId: null, pending: null });
  });
  localStorage.clear();
  window.history.replaceState(null, '');
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.restoreAllMocks();
});

describe('Layout', () => {
  it('renders the page between the header and the footer', () => {
    renderLayout();

    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
    expect(screen.getByTestId('greeting')).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByText('page content'));
  });

  it('shows the debugger only in developer mode', () => {
    const { unmount } = renderLayout(false);
    expect(screen.queryByTestId('debugger')).not.toBeInTheDocument();
    unmount();

    renderLayout(true);
    expect(screen.getByTestId('debugger')).toBeInTheDocument();
  });

  it('names the reset button with web.text.reset_form (#581)', async () => {
    useFormState.setState({ form, status: 'results' });
    renderWithProviders(
      <Layout>
        <p>page content</p>
      </Layout>,
      { config: makeConfig({ web: { text: { resetForm: 'Nouvelle requête' } } }) },
    );

    expect(await screen.findByRole('button', { name: 'Nouvelle requête' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });

  it('hides the reset button on the form view', () => {
    renderLayout();

    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });

  describe('browser history', () => {
    it('adds a history entry for the results view, once', async () => {
      const pushState = vi.spyOn(window.history, 'pushState');
      window.history.replaceState({ page: 'index' }, '');
      useFormState.setState({ form, status: 'results' });
      const { unmount } = renderLayout();
      await resetButton();

      expect(pushState).toHaveBeenCalledTimes(1);
      expect(window.history.state).toEqual({ page: 'index', ultraglass: 'results' });

      // A fresh mount runs the effect again. The results entry is already on the stack,
      // so the `history.state` guard must not push a second one.
      unmount();
      renderLayout();
      await resetButton();
      expect(pushState).toHaveBeenCalledTimes(1);
    });

    it('does not add a history entry on the form view', () => {
      const pushState = vi.spyOn(window.history, 'pushState');
      renderLayout();

      expect(pushState).not.toHaveBeenCalled();
    });

    it('returns to the form when the browser goes back from the results', async () => {
      useFormState.setState({ form, status: 'results' });
      renderLayout();
      await resetButton();

      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(useFormState.getState().status).toBe('form');
      // `back` keeps the query so it can be changed and sent again.
      expect(useFormState.getState().form).toEqual(form);
    });

    it('ignores history navigation on the form view', () => {
      const back = vi.fn();
      useFormState.setState({ back });
      renderLayout();

      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(back).not.toHaveBeenCalled();
    });

    it('stops listening when it unmounts', async () => {
      useFormState.setState({ form, status: 'results' });
      const { unmount } = renderLayout();
      await resetButton();
      unmount();

      window.dispatchEvent(new PopStateEvent('popstate'));

      expect(useFormState.getState().status).toBe('results');
    });
  });

  describe('browser history of an opened history entry', () => {
    it('adds a history entry while a saved query is open, once', () => {
      const pushState = vi.spyOn(window.history, 'pushState');
      window.history.replaceState({ page: 'index' }, '');
      const { unmount } = renderLayout();
      expect(pushState).not.toHaveBeenCalled();

      act(() => {
        useHistoryView.getState().open('saved');
      });

      expect(pushState).toHaveBeenCalledTimes(1);
      expect(window.history.state).toEqual({ page: 'index', ultraglass: 'history' });

      unmount();
      renderLayout();
      expect(pushState).toHaveBeenCalledTimes(1);
    });

    it('closes the saved query when the browser goes back', () => {
      useHistoryView.setState({ openId: 'saved' });
      renderLayout();

      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(useHistoryView.getState().openId).toBeNull();
      expect(useFormState.getState().status).toBe('form');
    });

    it('does not show the reset button for a saved query', () => {
      useHistoryView.setState({ openId: 'saved' });
      renderLayout();

      expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    });
  });

  describe('reset button', () => {
    it('goes back through history when the results view has its own entry', async () => {
      const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
      useFormState.setState({ form, status: 'results' });
      renderLayout();

      await userEvent.click(await resetButton());

      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      });
      expect(historyBack).toHaveBeenCalledTimes(1);
      // The popstate event that follows returns to the form.
      expect(useFormState.getState().status).toBe('results');
    });

    it('returns to the form directly when there is no results entry', async () => {
      const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
      // Something else replaced the history entry the layout added.
      vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
      useFormState.setState({ form, status: 'results' });
      renderLayout();

      await userEvent.click(await resetButton());

      expect(historyBack).not.toHaveBeenCalled();
      expect(useFormState.getState().status).toBe('form');
      expect(useFormState.getState().form).toEqual(form);
    });
  });
});
