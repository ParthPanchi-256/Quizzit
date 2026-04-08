import './Input.css';

export default function Input({ label, error, icon, type = 'text', id, ...props }) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={`input-group ${error ? 'input-error' : ''}`}>
      {label && <label htmlFor={inputId} className="input-label">{label}</label>}
      <div className="input-wrapper">
        {icon && <span className="input-icon">{icon}</span>}
        {type === 'textarea' ? (
          <textarea id={inputId} className={`input-field ${icon ? 'has-icon' : ''}`} {...props} />
        ) : (
          <input id={inputId} type={type} className={`input-field ${icon ? 'has-icon' : ''}`} {...props} />
        )}
      </div>
      {error && <span className="input-error-text">{error}</span>}
    </div>
  );
}
