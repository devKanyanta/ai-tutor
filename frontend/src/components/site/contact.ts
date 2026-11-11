/** Where people can reach us. The WhatsApp number is in international format without "+" (wa.me requires that). */
export const CONTACT = {
  whatsappNumber: '260765237189',
  phoneDisplay: '0765237189',
  phoneHref: 'tel:+260765237189',
  email: 'mapalokanyanta1@gmail.com',
  github: 'https://github.com/devKanyanta',
  githubHandle: '@devKanyanta',
};

export const whatsappLink = (message?: string) =>
  `https://wa.me/${CONTACT.whatsappNumber}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
