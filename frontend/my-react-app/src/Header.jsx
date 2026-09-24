function Header(props){
    return(
        <div>
            <h3>Hello {props.name}</h3>
            <h3>My skill is {props.skill}</h3>
        </div>
    )
}
export default Header