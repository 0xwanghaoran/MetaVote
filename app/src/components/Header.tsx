import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div className="header-content">
          <div className="header-left">
            <div>
              <h1 className="header-title">MetaVote</h1>
              <p className="header-subtitle">Confidential polls with public, verified results.</p>
            </div>
            <span className="header-badge">FHEVM</span>
          </div>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
