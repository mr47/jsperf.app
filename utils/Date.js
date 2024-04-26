export const DateTimeLong = ({date}) => {
  const dateString = new Date(date).toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' })
  return <>{dateString}</>
}

