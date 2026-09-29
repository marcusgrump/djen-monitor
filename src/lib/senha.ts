/** Validação mínima de nova senha. Retorna a mensagem de erro ou null. */
export function validarNovaSenha(senha: string, confirmacao: string): string | null {
  if (senha.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (senha !== confirmacao) return "As senhas não conferem.";
  return null;
}
