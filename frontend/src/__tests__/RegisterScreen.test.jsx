/**
 * Tests — Formulaire d'inscription
 * Vérifie les validations : mot de passe, consentement, champs obligatoires.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Fonction pour naviguer vers RegisterScreen
// On simule l'App en état 'register'
import App from '../App.jsx';

async function goToRegister() {
  render(<App />);
  const btn = screen.getByText('Essai gratuit');
  await userEvent.click(btn); // → RegisterScreen
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('RegisterScreen — validation du formulaire', () => {
  it('affiche le formulaire d\'inscription', async () => {
    await goToRegister();
    expect(screen.getByPlaceholderText('Mon Entreprise SAS')).toBeInTheDocument();
    expect(screen.getByText('Créer mon espace gratuit')).toBeInTheDocument();
  });

  it('affiche une erreur si les champs obligatoires sont vides', async () => {
    await goToRegister();
    const btn = screen.getByText('Créer mon espace gratuit');
    await userEvent.click(btn);
    expect(screen.getByText(/obligatoires/i)).toBeInTheDocument();
  });

  it('affiche une erreur si le mot de passe fait moins de 8 caractères', async () => {
    await goToRegister();

    await userEvent.type(screen.getByPlaceholderText('Mon Entreprise SAS'), 'Acme SAS');
    const inputs = screen.getAllByRole('textbox');
    // prénom, nom, email
    await userEvent.type(inputs.find(i => i.getAttribute('placeholder') === null && inputs.indexOf(i) > 0), 'Alice');

    // Remplir manuellement via les labels
    fireEvent.change(screen.getByPlaceholderText('Mon Entreprise SAS'), { target: { value: 'Acme SAS' } });
    fireEvent.change(screen.getByPlaceholderText('vous@entreprise.com'), { target: { value: 'alice@test.fr' } });

    // Trouver les champs password (type=password)
    const pwdFields = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwdFields[0], { target: { value: 'court' } }); // < 8 chars
    fireEvent.change(pwdFields[1], { target: { value: 'court' } });

    const btn = screen.getByText('Créer mon espace gratuit');
    await userEvent.click(btn);

    expect(screen.getByText(/8 caractères/i)).toBeInTheDocument();
  });

  it('affiche une erreur si les mots de passe ne correspondent pas', async () => {
    await goToRegister();

    fireEvent.change(screen.getByPlaceholderText('Mon Entreprise SAS'), { target: { value: 'Acme SAS' } });
    fireEvent.change(screen.getByPlaceholderText('vous@entreprise.com'), { target: { value: 'alice@test.fr' } });

    const pwdFields = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwdFields[0], { target: { value: 'motdepasse8' } });
    fireEvent.change(pwdFields[1], { target: { value: 'autremdp8' } }); // différent

    await userEvent.click(screen.getByText('Créer mon espace gratuit'));
    expect(screen.getByText(/correspondent pas/i)).toBeInTheDocument();
  });

  it('affiche une erreur si la case de consentement n\'est pas cochée', async () => {
    await goToRegister();

    // Remplir tous les champs correctement
    fireEvent.change(screen.getByPlaceholderText('Mon Entreprise SAS'), { target: { value: 'Acme SAS' } });
    fireEvent.change(screen.getByPlaceholderText('vous@entreprise.com'), { target: { value: 'alice@test.fr' } });

    const pwdFields = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwdFields[0], { target: { value: 'motdepasse8' } });
    fireEvent.change(pwdFields[1], { target: { value: 'motdepasse8' } });

    // NE PAS cocher la case RGPD
    await userEvent.click(screen.getByText('Créer mon espace gratuit'));
    expect(screen.getByText(/politique de confidentialité/i)).toBeInTheDocument();
  });

  it('soumet le formulaire si tout est valide', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ identifier: 'ACM-AM-1234', slug: 'acme-sas' }),
    });

    await goToRegister();

    fireEvent.change(screen.getByPlaceholderText('Mon Entreprise SAS'), { target: { value: 'Acme SAS' } });
    fireEvent.change(screen.getByPlaceholderText('vous@entreprise.com'), { target: { value: 'alice@test.fr' } });

    const pwdFields = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwdFields[0], { target: { value: 'motdepasse8' } });
    fireEvent.change(pwdFields[1], { target: { value: 'motdepasse8' } });

    // Cocher la case RGPD
    const checkbox = document.querySelector('input[type="checkbox"]');
    await userEvent.click(checkbox);

    await userEvent.click(screen.getByText('Créer mon espace gratuit'));

    await waitFor(() => {
      expect(screen.getByText('Compte créé !')).toBeInTheDocument();
    });
  });
});

describe('RegisterScreen — lien politique de confidentialité', () => {
  it('affiche un lien vers la politique de confidentialité', async () => {
    await goToRegister();
    expect(screen.getByText('politique de confidentialité')).toBeInTheDocument();
  });
});
