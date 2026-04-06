/**
 * Tests — Section tarifs
 * Vérifie que les 5 plans s'affichent et que le toggle annuel fonctionne.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App.jsx';

// On teste LandingPage via App en mode non-connecté
// Mock de fetch pour éviter les appels réseau
global.fetch = vi.fn();

describe('PricingSection — affichage des plans', () => {
  it('affiche les 5 plans tarifaires', () => {
    render(<App />);
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.getByText('Scale')).toBeInTheDocument();
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  it('affiche le badge "Populaire" sur le plan Business', () => {
    render(<App />);
    expect(screen.getByText('Populaire')).toBeInTheDocument();
  });

  it('affiche les prix mensuels par défaut', () => {
    render(<App />);
    expect(screen.getByText('0 €')).toBeInTheDocument();
    expect(screen.getByText('29 €')).toBeInTheDocument();
    expect(screen.getByText('59 €')).toBeInTheDocument();
    expect(screen.getByText('99 €')).toBeInTheDocument();
  });

  it('affiche "Sur devis" pour Enterprise', () => {
    render(<App />);
    expect(screen.getByText('Sur devis')).toBeInTheDocument();
  });

  it('affiche le nombre d\'utilisateurs par plan', () => {
    render(<App />);
    expect(screen.getByText('5 utilisateurs')).toBeInTheDocument();
    expect(screen.getByText('15 utilisateurs')).toBeInTheDocument();
    expect(screen.getByText('40 utilisateurs')).toBeInTheDocument();
    expect(screen.getByText('100 utilisateurs')).toBeInTheDocument();
    expect(screen.getByText('100+ utilisateurs')).toBeInTheDocument();
  });

  it('passe aux prix annuels (-20%) après avoir cliqué le toggle', () => {
    render(<App />);
    // Prix mensuel initial
    expect(screen.getByText('29 €')).toBeInTheDocument();

    // Cliquer sur le toggle annuel
    const toggle = screen.getByText('Annuel', { exact: false }).closest('span').previousElementSibling;
    fireEvent.click(toggle);

    // Prix annuel
    expect(screen.getByText('23 €')).toBeInTheDocument();
    expect(screen.getByText('47 €')).toBeInTheDocument();
    expect(screen.getByText('79 €')).toBeInTheDocument();
  });

  it('revient aux prix mensuels après un second clic sur le toggle', () => {
    render(<App />);
    const toggle = screen.getByText('Annuel', { exact: false }).closest('span').previousElementSibling;
    fireEvent.click(toggle); // → annuel
    fireEvent.click(toggle); // → mensuel
    expect(screen.getByText('29 €')).toBeInTheDocument();
  });
});

describe('PricingSection — appels à l\'action', () => {
  it('les boutons "Démarrer gratuitement" et "Commencer" sont présents', () => {
    render(<App />);
    expect(screen.getByText('Démarrer gratuitement')).toBeInTheDocument();
    const commencerBtns = screen.getAllByText('Commencer');
    expect(commencerBtns.length).toBeGreaterThanOrEqual(3); // Team, Business, Scale
  });

  it('le bouton "Nous contacter" est présent pour Enterprise', () => {
    render(<App />);
    expect(screen.getByText('Nous contacter')).toBeInTheDocument();
  });
});
