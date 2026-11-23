import { InputGroup, InputRightElement } from '@chakra-ui/react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, testConfig } from '~/__tests__/render';
import { UserIP } from './user-ip';

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('~/hooks', async importOriginal => ({
  ...(await importOriginal<typeof import('~/hooks')>()),
  useMobile: () => mobile.value,
}));

const IPV4 = '203.0.113.123';
const IPV6 = '2001:db8::1234';
const { text } = testConfig.web;

/** The My IP button where the target field has it: in an input group, inside the form. */
function renderInForm(setTarget = vi.fn()) {
  const result = renderWithProviders(
    <form data-testid="form">
      <InputGroup>
        <InputRightElement>
          <UserIP setTarget={setTarget} />
        </InputRightElement>
      </InputGroup>
      <button type="submit">Submit Query</button>
    </form>,
  );
  return { ...result, setTarget };
}

beforeEach(() => {
  // The fixture's `myIp` is `server`: the addresses come from /api/myip.
  expect(testConfig.web.myIp).toBe('server');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const ip = String(input).includes('family=6') ? IPV6 : IPV4;
    return new Response(JSON.stringify({ ip }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  mobile.value = false;
});

describe('UserIP on a wide screen', () => {
  it('renders its popover outside the form, so the fields after it cannot cover it', async () => {
    renderInForm();
    fireEvent.click(screen.getByRole('button', { name: text.ipButton }));
    const prompt = await screen.findByRole('dialog');
    await screen.findByText(text.ipSelect);
    // The input group is a stacking context (`isolation: isolate`): a popover inside it
    // is painted under the submit button that follows it in the form (#271).
    expect(screen.getByTestId('form')).not.toContainElement(prompt);
    expect(document.body).toContainElement(prompt);
  });

  it('fills the target with the address chosen and closes', async () => {
    const { setTarget } = renderInForm();
    fireEvent.click(screen.getByRole('button', { name: text.ipButton }));
    fireEvent.click(await screen.findByRole('button', { name: IPV6 }));
    expect(setTarget).toHaveBeenCalledWith(IPV6);
    await waitFor(() => expect(screen.queryByText(text.ipSelect)).not.toBeVisible());
  });

  it('closes on Escape and returns the focus to the button', async () => {
    renderInForm();
    const button = screen.getByRole('button', { name: text.ipButton });
    fireEvent.click(button);
    const prompt = await screen.findByRole('dialog');
    await screen.findByRole('button', { name: IPV4 });
    fireEvent.keyDown(prompt, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(text.ipSelect)).not.toBeVisible());
    await waitFor(() => expect(button).toHaveFocus());
  });
});

describe('UserIP keyboard order on a wide screen', () => {
  // The popover is rendered at the end of the page, so the browser's own order would
  // take Tab from its last button to the end of the page, and Shift+Tab from its first
  // to whatever comes before it there. Keep the order it has next to the button.
  it('moves Tab from the last address to the field after the button, and closes', async () => {
    const user = userEvent.setup();
    renderInForm();
    await user.click(screen.getByRole('button', { name: text.ipButton }));
    const last = await screen.findByRole('button', { name: IPV6 });
    last.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Submit Query' })).toHaveFocus();
    await waitFor(() => expect(screen.queryByText(text.ipSelect)).not.toBeVisible());
    expect(screen.getByRole('button', { name: 'Submit Query' })).toHaveFocus();
  });

  it('moves Shift+Tab from the close button back to the button, and closes', async () => {
    const user = userEvent.setup();
    renderInForm();
    const button = screen.getByRole('button', { name: text.ipButton });
    await user.click(button);
    await screen.findByRole('button', { name: IPV4 });
    screen.getByRole('button', { name: 'Close' }).focus();
    await user.tab({ shift: true });
    expect(button).toHaveFocus();
    await waitFor(() => expect(screen.queryByText(text.ipSelect)).not.toBeVisible());
  });

  it('moves Shift+Tab from the popover itself back to the button', async () => {
    const user = userEvent.setup();
    renderInForm();
    const button = screen.getByRole('button', { name: text.ipButton });
    await user.click(button);
    const prompt = await screen.findByRole('dialog');
    await screen.findByRole('button', { name: IPV4 });
    prompt.focus();
    await user.tab({ shift: true });
    expect(button).toHaveFocus();
  });

  it('keeps Tab inside the popover between its own buttons', async () => {
    const user = userEvent.setup();
    renderInForm();
    await user.click(screen.getByRole('button', { name: text.ipButton }));
    const first = await screen.findByRole('button', { name: IPV4 });
    first.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: IPV6 })).toHaveFocus();
    expect(screen.getByText(text.ipSelect)).toBeVisible();
  });
});

describe('UserIP on a small screen', () => {
  it('shows the addresses in a dialog outside the form', async () => {
    mobile.value = true;
    const { setTarget } = renderInForm();
    fireEvent.click(screen.getByRole('button', { name: text.ipButton }));
    const prompt = await screen.findByRole('dialog');
    expect(screen.getByTestId('form')).not.toContainElement(prompt);
    fireEvent.click(await screen.findByRole('button', { name: IPV4 }));
    expect(setTarget).toHaveBeenCalledWith(IPV4);
  });
});
