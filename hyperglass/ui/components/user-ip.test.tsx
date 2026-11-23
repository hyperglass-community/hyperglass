import { InputGroup, InputRightElement } from '@chakra-ui/react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
